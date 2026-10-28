-- YKR World Database Schema (SQLite / Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  mobile TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT DEFAULT 'Member',
  created TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mobile, role)
);

CREATE TABLE IF NOT EXISTS otps (
  mobile TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires INTEGER NOT NULL,
  tries INTEGER DEFAULT 0,
  sent INTEGER DEFAULT 0,
  win INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  qualification TEXT,
  experience TEXT,
  area TEXT,
  skills TEXT,
  approved INTEGER DEFAULT 1,
  created TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  vertical TEXT,
  message TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  created TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial candidates
INSERT OR IGNORE INTO candidates(id, name, qualification, experience, area, skills, approved) VALUES
(1, 'Aditi S.', 'B.Com', '2 yrs', 'Pune', 'Sales, Communication', 1),
(2, 'Rohan K.', 'BBA', 'Fresher', 'Pimpri-Chinchwad', 'Digital Marketing, Social Media', 1),
(3, 'Sneha M.', 'BA', '1 yr', 'Chikhali', 'Customer Support, Spoken English', 1),
(4, 'Vikram J.', 'MBA', '4 yrs', 'Chinchwad', 'Sales, Team Management', 1),
(5, 'Pooja T.', 'BCA', 'Fresher', 'Talwade', 'Web Development, SEO', 1);

-- Seed initial admin user (+91 7218550652)
INSERT OR IGNORE INTO users(id, mobile, role, name) VALUES
(1, '7218550652', 'Admin', 'YKR Super Admin');
