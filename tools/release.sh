#!/bin/bash
# One release, in its safe order: staging first (its migrations, its worker, its pages), a quick check of the stations on it,
# then live only if the check passed and a person types «live». Never during a client's event.
#   ADMIN_KEY_STAGING=<staging key> ADMIN_KEY_LIVE=<live key> tools/release.sh            (staging, check, then live on a yes)
#   ADMIN_KEY_STAGING=<staging key> tools/release.sh --staging-only
set -euo pipefail; cd "$(dirname "$0")/.."
STAGING=https://basserh-staging.omarabdelhaamid.workers.dev; LIVE=https://live.basserh.com
: "${ADMIN_KEY_STAGING:?ضعوا مفتاح المرحلة التجريبية في ADMIN_KEY_STAGING}"
say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
[ -z "$(git status --porcelain)" ] || { echo "في المجلد تعديلات لم تُحفظ في git. احفظوها أو تجاهلوها قبل النشر."; exit 1; }
git fetch -q origin main; [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "هذه ليست آخر نسخة من main. نفّذوا: git checkout main && git pull"; exit 1; }
say "١. المرحلة التجريبية: قاعدة التحكم"; node tools/migrate.mjs staging
say "٢. المرحلة التجريبية: الخادم"; npx wrangler@4 deploy -c wrangler.staging.toml
say "٣. المرحلة التجريبية: الصفحات"; BASE=$STAGING ADMIN_KEY=$ADMIN_KEY_STAGING node tools/push_site.mjs
say "٤. فحص المحطات على المرحلة التجريبية"; BASE=$STAGING ADMIN_KEY=$ADMIN_KEY_STAGING node test/smoke_stations.cjs || { echo "فشل الفحص. توقف النشر، والموقع الحي كما هو."; exit 1; }
[ "${1:-}" = "--staging-only" ] && { say "انتهى النشر على المرحلة التجريبية."; exit 0; }
: "${ADMIN_KEY_LIVE:?ضعوا مفتاح الموقع الحي في ADMIN_KEY_LIVE}"
say "٥. الموقع الحي"; echo "تأكدوا أن لا معرض ولا حفل جارياً الآن عند أي جهة."; read -r -p "اكتبوا live للنشر على الموقع الحي، أو أي شيء آخر للتوقف: " ans
[ "$ans" = "live" ] || { echo "توقف. الموقع الحي كما هو."; exit 0; }
node tools/migrate.mjs live
npx wrangler@4 deploy -c wrangler.live.toml
BASE=$LIVE ADMIN_KEY=$ADMIN_KEY_LIVE node tools/push_site.mjs
say "٦. التحقق من الموقع الحي (قراءة فقط)"; bad=0
for p in / /screen /run/station.html /run/stations.html /sw.js; do c=$(curl -s -o /dev/null -w "%{http_code}" "$LIVE$p"); echo "$p $c"; [ "$c" = "200" ] || bad=1; done
[ $bad = 0 ] && say "نُشر على الموقع الحي، وصفحاته تجيب." || { echo "صفحة لم تُجب. راجعوا سجل Cloudflare، ويمكن الرجوع بـ: npx wrangler@4 rollback -c wrangler.live.toml"; exit 1; }
