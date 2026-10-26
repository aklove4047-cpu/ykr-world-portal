// Usage: npm run backup   (schedule daily with cron; copy the file off-server too)
const fs = require('fs'), path = require('path');
const db = require('../db');
const dir = path.join(__dirname, '..', 'backups'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `ykr-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
db.backup(file).then(() => {
  console.log('Backup written:', file);
  fs.readdirSync(dir).sort().slice(0, -14).forEach(f => fs.unlinkSync(path.join(dir, f))); // keep last 14
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
