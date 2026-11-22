// The organisations the automatic tests leave behind (their owner has a test address), removed with their files:
//   BASE=<server> ADMIN_KEY=<its key> node tools/clean_tests.mjs        (the owner page's «حذف جهات الاختبار», from the command line)
const B = process.env.BASE, K = process.env.ADMIN_KEY; if (!B || !K) { console.log('ضعوا BASE و ADMIN_KEY'); process.exit(1); }
const r = await fetch(B + '/api/admin/purge-tests', { method: 'POST', headers: { 'x-admin-key': K, 'content-type': 'application/json', 'user-agent': 'basserh-tools' }, body: JSON.stringify({ confirm: 'حذف جهات الاختبار' }) });
const j = await r.json().catch(() => ({})); if (!r.ok) { console.log('تعذّر الحذف:', j.error || r.status); process.exit(1); }
console.log('حُذفت جهات الاختبار:', JSON.stringify(j));
