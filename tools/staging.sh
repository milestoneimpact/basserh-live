#!/bin/bash
# The test copy of the platform (basserh-staging.<account>.workers.dev): its own database, bucket and rooms, so a change is tried there before live.basserh.com
#   ADMIN_KEY=<staging key> tools/staging.sh   (the key is set once with: npx wrangler secret put ADMIN_KEY -c wrangler.staging.toml)
set -e; cd "$(dirname "$0")/.."
npx wrangler@4 deploy -c wrangler.staging.toml
BASE=https://basserh-staging.omarabdelhaamid.workers.dev node tools/push_site.mjs
