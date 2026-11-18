-- what the platform owner did (organisations created, changed, deleted; passwords renewed; backups), for the owner's own page
CREATE TABLE IF NOT EXISTS platform_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
