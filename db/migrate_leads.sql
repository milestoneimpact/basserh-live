-- requests sent from the public page's contact form
CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, org TEXT, phone TEXT, email TEXT, kind TEXT, event_date TEXT, message TEXT, ip TEXT, created_at TEXT NOT NULL, handled_at TEXT, mailed INTEGER NOT NULL DEFAULT 0);
