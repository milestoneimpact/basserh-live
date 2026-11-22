-- a password for a member (the owner of an organisation receives one with the organisation's address): "salt:hash", PBKDF2 SHA-256
ALTER TABLE users ADD COLUMN pw TEXT;
