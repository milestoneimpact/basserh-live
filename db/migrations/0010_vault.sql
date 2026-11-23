-- the files' vault: a file whose source left the bucket is kept in the vault for thirty days from the day it was found missing, then removed
CREATE TABLE IF NOT EXISTS vault_gone (key TEXT PRIMARY KEY, since TEXT NOT NULL);
