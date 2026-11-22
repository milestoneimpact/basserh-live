-- the kind of an organisation, chosen by the platform owner: 'ceremony' (events on a stage) or 'stations' (an exhibition of
-- interactive screens). An organisation of one kind sees and makes that kind only; NULL: both (the organisations made before)
ALTER TABLE orgs ADD COLUMN kind TEXT;
