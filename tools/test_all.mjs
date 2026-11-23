// Every automatic test, one after another, each with its own time limit, and one summary at the end:
//   node tools/test_all.mjs [name …]        (a local server: npm run db && npm run dev; BASE and ADMIN_KEY as for each test)
// The tests that need arguments (live_check, tenant_check) or only take pictures (landing_shots) are left out; name them to run them.
// A test that hangs is stopped at its limit and counted as failed; the log of each is kept in test/.logs/.
import { spawn } from 'node:child_process'; import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
const SKIP = new Set(['live_check', 'tenant_check', 'landing_shots']), LIMIT = { rehearsal20: 900, spare: 420, dayrun: 600, speed: 420 };
const asked = process.argv.slice(2), names = asked.length ? asked : readdirSync('test').filter(f => f.endsWith('.cjs') && !f.startsWith('_')).map(f => f.slice(0, -4)).filter(n => !SKIP.has(n)).sort();
mkdirSync('test/.logs', { recursive: true });
const run = (cmd, args, secs) => new Promise(res => { const p = spawn(cmd, args, { env: process.env }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const t = setTimeout(() => { out += `\n✗ stopped after ${secs} s`; p.kill('SIGKILL'); }, secs * 1000); p.on('close', code => { clearTimeout(t); res({ code, out }); }); });
const rows = []; const t0 = Date.now();
{ const r = await run('node', ['--test', 'test/engine.test.mjs'], 120), pass = +(r.out.match(/# pass (\d+)/) || [])[1] || 0, fail = +(r.out.match(/# fail (\d+)/) || [])[1] || 0; rows.push({ name: 'engine', pass, fail: fail || (r.code ? 1 : 0), s: 0, bad: fail ? ['engine tests failed'] : [] }); writeFileSync('test/.logs/engine.log', r.out); }
for (const n of names) { const a = Date.now(); process.stdout.write(`${n} … `); const r = await run('node', [`test/${n}.cjs`], LIMIT[n] || 450), lines = r.out.split('\n');
  const pass = lines.filter(l => l.startsWith('✓')).length, bad = lines.filter(l => l.startsWith('✗')); writeFileSync(`test/.logs/${n}.log`, r.out);
  const row = { name: n, pass, fail: bad.length || (r.code ? 1 : 0), s: Math.round((Date.now() - a) / 1000), bad }; rows.push(row); console.log(row.fail ? `✗ ${row.fail} (${pass} ✓, ${row.s} s)` : `✓ ${pass} (${row.s} s)`); }
const failed = rows.filter(r => r.fail);
console.log(`\n${rows.length} tests · ${rows.reduce((a, r) => a + r.pass, 0)} checks passed · ${failed.length ? failed.length + ' failed' : 'none failed'} · ${Math.round((Date.now() - t0) / 60000)} min`);
for (const r of failed) { console.log(`\n✗ ${r.name}:`); for (const l of r.bad.slice(0, 4)) console.log('   ' + l.slice(0, 220)); }
process.exit(failed.length ? 1 : 0);
