const express = require('express');
const crypto = require('crypto');
const L = require('./lib');
const { db } = L;
const r = express.Router();

const KEY = process.env.RAZORPAY_KEY_ID, SEC = process.env.RAZORPAY_KEY_SECRET;
const MOCK = process.env.MOCK_PAYMENTS === 'true' && !KEY;
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const withBalance = (i) => { const paid = L.paidSum(i.invoice_id); return { ...i, paid_paise: paid, balance_paise: Math.max(0, i.total_paise - paid) }; };

// List my invoices (own, or my company's). Accounts/admin see all.
r.get('/invoices', L.auth, (req, res) => {
  const u = req.user;
  let rows;
  if (L.has(u, 'accounts')) rows = db.prepare('SELECT * FROM invoices ORDER BY invoice_id DESC LIMIT 200').all();
  else {
    const cids = L.companyIds(u.user_id);
    const q = cids.length ? ` OR company_id IN (${cids.map(() => '?').join(',')})` : '';
    rows = db.prepare(`SELECT * FROM invoices WHERE user_id=?${q} ORDER BY invoice_id DESC LIMIT 200`).all(u.user_id, ...cids);
  }
  res.json(rows.map(withBalance));
});

// My paid payments with receipt numbers.
r.get('/my-payments', L.auth, (req, res) => {
  const u = req.user, cids = L.companyIds(u.user_id);
  const where = L.has(u, 'accounts') ? '1=1' : `(i.user_id=? OR i.company_id IN (${cids.map(() => '?').join(',') || 'NULL'}))`;
  const args = L.has(u, 'accounts') ? [] : [u.user_id, ...cids];
  res.json(db.prepare(`SELECT p.payment_id, i.invoice_number, p.amount_paise, p.method, p.paid_at, rc.receipt_number
    FROM payments p JOIN invoices i ON i.invoice_id=p.invoice_id LEFT JOIN receipts rc ON rc.payment_id=p.payment_id
    WHERE p.status='paid' AND ${where} ORDER BY p.payment_id DESC LIMIT 200`).all(...args));
});

// Pay Now: server decides the amount (outstanding balance). The browser never sends an amount.
r.post('/invoices/:id/pay', L.auth, async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE invoice_id=?').get(req.params.id);
  if (!inv || !L.canSeeInvoice(req.user, inv)) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'cancelled' || inv.status === 'paid') return res.status(400).json({ error: 'Nothing to pay' });
  const amount = inv.total_paise - L.paidSum(inv.invoice_id);
  if (amount <= 0) return res.status(400).json({ error: 'Nothing to pay' });
  try {
    let orderId;
    if (MOCK) orderId = 'mock_' + crypto.randomBytes(8).toString('hex');
    else {
      if (!KEY || !SEC) return res.status(503).json({ error: 'Payment gateway not configured' });
      const resp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${KEY}:${SEC}`).toString('base64') },
        body: JSON.stringify({ amount, currency: 'INR', receipt: inv.invoice_number, notes: { invoice_id: String(inv.invoice_id) } })
      });
      const o = await resp.json();
      if (!resp.ok) throw new Error(o.error?.description || 'Razorpay error');
      orderId = o.id;
    }
    db.prepare("INSERT INTO payments(invoice_id,provider,provider_order_id,amount_paise,status) VALUES(?,?,?,?,'created')")
      .run(inv.invoice_id, MOCK ? 'mock' : 'razorpay', orderId, amount);
    res.json({ order_id: orderId, amount, currency: 'INR', key: KEY || 'mock', mock: MOCK, invoice_number: inv.invoice_number, name: req.user.name });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Could not start payment' }); }
});

// Single place where a payment becomes "paid". Idempotent.
function settle(orderId, paymentId, method, actor) {
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(orderId);
    if (!p) return { ok: false, reason: 'unknown_order' };
    if (p.status === 'paid') return { ok: true, duplicate: true, payment: p };
    db.prepare("UPDATE payments SET status='paid', provider_payment_id=?, method=?, paid_at=? WHERE payment_id=?")
      .run(paymentId || null, method || null, L.now(), p.payment_id);
    const num = `RCT-${new Date().getFullYear()}-${String(p.payment_id).padStart(6, '0')}`;
    db.prepare('INSERT OR IGNORE INTO receipts(payment_id,receipt_number) VALUES(?,?)').run(p.payment_id, num);
    const inv = L.refreshInvoice(p.invoice_id);
    if (L.paidSum(p.invoice_id) > inv.total_paise) L.audit(actor, 'overpayment_flag', 'invoice', p.invoice_id);
    L.audit(actor, 'payment_paid', 'payment', p.payment_id, { order: orderId, amount: p.amount_paise });
    L.notify(inv.user_id, 'payment', `Payment received for ${inv.invoice_number}. Receipt ${num}.`);
    return { ok: true, payment: p, invoice_status: inv.status, receipt: num };
  })();
}

// Browser return: verify Razorpay signature server-side.
r.post('/payments/verify', L.auth, (req, res) => {
  const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
  const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(o);
  const inv = pay && db.prepare('SELECT * FROM invoices WHERE invoice_id=?').get(pay.invoice_id);
  if (!pay || !L.canSeeInvoice(req.user, inv)) return res.status(404).json({ error: 'Payment not found' });
  if (!SEC || !safeEq(hmac(SEC, `${o}|${p}`), s)) return res.status(400).json({ error: 'Signature mismatch' });
  const out = settle(o, p, 'razorpay', req.user.user_id);
  res.json({ ok: out.ok, status: out.invoice_status, receipt: out.receipt });
});

// Local testing only (MOCK_PAYMENTS=true and no Razorpay key).
r.post('/payments/mock-confirm', L.auth, (req, res) => {
  if (!MOCK) return res.status(404).end();
  const pay = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(req.body?.order_id);
  const inv = pay && db.prepare('SELECT * FROM invoices WHERE invoice_id=?').get(pay.invoice_id);
  if (!pay || !L.canSeeInvoice(req.user, inv)) return res.status(404).json({ error: 'Payment not found' });
  const out = settle(pay.provider_order_id, 'mockpay_' + pay.payment_id, 'mock', req.user.user_id);
  res.json({ ok: out.ok, status: out.invoice_status, receipt: out.receipt });
});

// Webhook handler: mounted with express.raw() in server.js so the signature covers the exact bytes.
function webhook(req, res) {
  const raw = req.body; // Buffer
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const sig = req.get('x-razorpay-signature');
  const eventId = req.get('x-razorpay-event-id');
  if (!secret || !eventId || !safeEq(hmac(secret, raw), sig)) return res.status(400).json({ error: 'bad signature' });
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  const ins = db.prepare('INSERT OR IGNORE INTO payment_events(provider_event_id,event_type,payload,signature_verified,processing_status) VALUES(?,?,?,1,?)')
    .run(eventId, body.event, raw.toString('utf8'), 'received');
  if (ins.changes === 0) return res.json({ ok: true, duplicate: true }); // already processed
  const ent = body.payload?.payment?.entity;
  let status = 'ignored';
  if (ent && (body.event === 'payment.captured' || body.event === 'order.paid')) {
    const p = db.prepare('SELECT * FROM payments WHERE provider_order_id=?').get(ent.order_id);
    if (p && p.amount_paise === ent.amount) { settle(ent.order_id, ent.id, ent.method, null); status = 'processed'; }
    else status = 'amount_or_order_mismatch';
  } else if (ent && body.event === 'payment.failed') {
    db.prepare("UPDATE payments SET status='failed' WHERE provider_order_id=? AND status='created'").run(ent.order_id);
    status = 'processed';
  }
  db.prepare('UPDATE payment_events SET processing_status=? WHERE provider_event_id=?').run(status, eventId);
  res.json({ ok: true });
}

r.get('/receipts/:paymentId', L.auth, (req, res) => {
  const row = db.prepare(`SELECT rc.*, p.amount_paise, p.method, p.paid_at, i.invoice_number, i.description, i.user_id, i.company_id
    FROM receipts rc JOIN payments p ON p.payment_id=rc.payment_id JOIN invoices i ON i.invoice_id=p.invoice_id WHERE rc.payment_id=?`).get(req.params.paymentId);
  if (!row || !L.canSeeInvoice(req.user, row)) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

module.exports = { router: r, webhook, settle };
