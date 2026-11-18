#!/bin/bash
# Everything the studio needs on Cloudflare, in the Basserh account, in one run:
# the database (D1), the files bucket (R2), the tables, the owner key, the worker, then the first organisation (WAMY) with its ceremony.
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ADMIN_KEY=<a long secret> DOMAIN=live.basserh.com BASE=https://live.basserh.com OWNER=<the WAMY owner's email> ./deploy.sh
# The token needs: Workers Scripts edit, D1 edit, R2 edit (and Zone / Workers Routes edit to attach the basserh domain).
# Safe to run again: what exists is kept.
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?} ${CLOUDFLARE_ACCOUNT_ID:?} ${ADMIN_KEY:?}"
W="npx --yes wrangler@4"

# 1. the database: created once, its id written into wrangler.toml
ID=$($W d1 list --json | python3 -c "import sys,json;print(next((d['uuid'] for d in json.load(sys.stdin) if d['name']=='basserh-live'),''))")
if [ -z "$ID" ]; then $W d1 create basserh-live >/dev/null; ID=$($W d1 list --json | python3 -c "import sys,json;print(next(d['uuid'] for d in json.load(sys.stdin) if d['name']=='basserh-live'))"); NEW=1; fi
sed -i "s/^database_id = .*/database_id = \"$ID\"/" wrangler.toml
# 2. the tables (a new database only)
if [ "${NEW:-}" = 1 ]; then $W d1 execute basserh-live --remote --file db/control.sql; fi
# 3. the bucket of the organisations' files
$W r2 bucket create basserh-live-media 2>/dev/null || true
# 4. the worker (on DOMAIN when given, e.g. DOMAIN=live.basserh.com: the zone basserh.com must be in this account) and the owner's key
if [ -n "${DOMAIN:-}" ] && ! grep -q '^routes' wrangler.toml; then sed -i "/^compatibility_date/a routes = [{ pattern = \"$DOMAIN\", custom_domain = true }]" wrangler.toml; fi
$W deploy
printf '%s' "$ADMIN_KEY" | $W secret put ADMIN_KEY
echo "deployed. Attach the domain in wrangler.toml (routes) or in the dashboard, then:"
echo "  BASE=https://<the studio address> ADMIN_KEY=... OWNER=... node tools/seed_tenant.mjs tenants/wamy"
# 5. the first organisation, when the address is known
if [ -n "${BASE:-}" ]; then BASE="$BASE" ADMIN_KEY="$ADMIN_KEY" OWNER="${OWNER:-}" MEDIA="${MEDIA:-..}" node tools/seed_tenant.mjs tenants/wamy; fi
