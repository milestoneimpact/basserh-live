-- a screen paired at its organisation's own address (/<slug>/screen): its code can be claimed by that organisation only
ALTER TABLE pairs ADD COLUMN org TEXT;
