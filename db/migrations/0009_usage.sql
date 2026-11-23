-- the requests of each day, by organisation (counted in memory and written in batches), so the platform owner sees how close the day is to the plan's limit
CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, org TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, org));
