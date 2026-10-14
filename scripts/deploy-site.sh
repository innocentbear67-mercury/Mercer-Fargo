#!/bin/sh
# Publish the static site to Cloudflare (mercerfargo.trade, Workers static assets). Run from anywhere; needs `wrangler login`.
# Ships only what the browser loads: no tests, worker, videos, scripts, or the system-prompts doc.
set -e
cd "$(dirname "$0")/.."
out=.work/site
rm -rf "$out" && mkdir -p "$out/docs"
cp index.html 404.html cloud.js xpf.js trades.js desk.js drawing.js fundamentals.js genui.js harness.js indicators.js mathengine.js memo-pdf.js qengine.js "$out"/
cp -R assets "$out"/assets
cp docs/marvell-guide.md "$out"/docs/
cp -R kronos "$out"/kronos
npx wrangler@4 deploy -c site.wrangler.toml
