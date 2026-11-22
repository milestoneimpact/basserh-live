# basserh-live · instructions for AI agents

The ceremony studio of «بصيرة» (Basserh), rented to several organisations; live at https://live.basserh.com. Read `README.md` first (Arabic): structure, isolation, running, deploying.

* One code base for every organisation; an organisation is data. Its events, versions, files index, links and audit live in its own database (`worker/tenant.js`, a Durable Object with SQLite); the control database (`db/control.sql`, D1) holds accounts only. Never add a table that mixes two organisations' rows.
* The rules of a running event are `web/engine/` (shared by the worker and the pages), driven by the event document; no cue ids in code. Run `npm test` after touching it, and `npm run test:e2e` (needs `npm run db && npm run dev`) after touching the worker or the pages.
* The studio, the console and the owner's page carry the Basserh identity (`web/app.css`, `web/brand/`); the screens of a running event carry the organisation's own identity.
* Usage model (owner, 22 Nov): no activation days and no event limit. An organisation that has its link uses everything freely (building, rehearsals, training, the day) while it is switched on; the platform owner's only control is the off switch. Every feature (the stations included) is open to every organisation that is on; storage is 20 GB each. A new version is held back only while the hall is running (the operator turned the screens on), until a clear yes.
* Deploy: the worker with `wrangler.live.toml`; the pages of `web/` are pushed into the bucket with `tools/push_site.mjs` after every change in `web/`. `ADMIN_KEY` is a Cloudflare secret, never in the repository.
* Arabic on every user facing text: plain, dignified; no dashes, no «ليس كذا، بل كذا».
* The server is split by role: `worker/index.js` (routes), `util.js`, `auth.js`, `mail.js`, `brand.js`, `data.js`, plus `room.js`, `tenant.js`, `passkey.js`.
* Control database changes are numbered files in `db/migrations/NNNN_name.sql`, applied once each with `node tools/migrate.mjs <staging|live>` (kept in `schema_migrations`).
* Staging: `wrangler.staging.toml`, deployed with `tools/staging.sh` (its own database, bucket and admin key). Every change goes to staging and its tests first, then to live, never during a client's event.
