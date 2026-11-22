// The control database's changes, in order:  node tools/migrate.mjs <live|staging|local> [--mark]
//   db/migrations/NNNN_name.sql run once each, in the order of their numbers; the ones already run are kept in schema_migrations.
//   --mark: record every file as run without running it (a database built from db/control.sql, which already holds them all).
import fs from 'fs'; import { execFileSync } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), [where = 'local', flag] = process.argv.slice(2);
const T = { live: ['basserh-live', 'wrangler.live.toml', '--remote'], staging: ['basserh-staging', 'wrangler.staging.toml', '--remote'], local: ['basserh-live', 'wrangler.toml', '--local'] }[where];
if (!T) { console.log('المكان: live أو staging أو local'); process.exit(1); }
const d1 = args => JSON.parse(execFileSync('npx', ['wrangler@4', 'd1', 'execute', T[0], T[2], '-c', T[1], '--json', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
d1(['--command', 'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, at TEXT NOT NULL)']);
const done = new Set(d1(['--command', 'SELECT name FROM schema_migrations'])[0].results.map(r => r.name));
const files = fs.readdirSync(path.join(ROOT, 'db/migrations')).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
let n = 0; for (const f of files) { if (done.has(f)) continue;
  if (flag !== '--mark') { try { d1(['--file', path.join('db/migrations', f)]); } catch (e) { if (!/duplicate column name/.test(String(e.stdout || e))) throw e;
      // a column the server already added by itself: the file is run statement by statement, passing over what is already there
      for (const q of fs.readFileSync(path.join(ROOT, 'db/migrations', f), 'utf8').replace(/^--.*$/gm, '').split(';').map(x => x.trim()).filter(Boolean)) try { d1(['--command', q]); } catch (x) { if (!/duplicate column name/.test(String(x.stdout || x))) throw x; } }
    console.log('ran', f); } else console.log('marked', f);
  d1(['--command', `INSERT INTO schema_migrations (name, at) VALUES ('${f}', '${new Date().toISOString()}')`]); n++; }
console.log(n ? `${where}: ${n} change(s) recorded` : `${where}: up to date (${files.length})`);
