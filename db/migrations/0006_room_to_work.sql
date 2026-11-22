-- owner, 22 Nov: a switched on organisation works without limits; storage is raised to 20 GB for every organisation
UPDATE orgs SET storage_limit_mb = 20000 WHERE storage_limit_mb < 20000;
