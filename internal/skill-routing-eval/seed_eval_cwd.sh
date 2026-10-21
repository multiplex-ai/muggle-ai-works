#!/usr/bin/env bash
# Seeds the routing eval's cwd with a small web app carrying real uncommitted
# changes, so change-driven queries ("test my changes", "validate what I've
# been working on") have a referent. Without one the model inspects, finds no
# repo and no diff, and correctly answers that there is nothing to test —
# scoring `none` however the skill is described. The app stays isolated from
# this repo, so the plugin is still the only skill source. Both hosts' CI jobs
# seed the same app, so their recall is measured on the same fixture.
#
#   bash internal/skill-routing-eval/seed_eval_cwd.sh <dir>

set -euo pipefail

dir="${1:?usage: seed_eval_cwd.sh <dir>}"
mkdir -p "$dir/src"
cd "$dir"
git init -q
git config user.email eval@example.com
git config user.name "routing eval"
cat > package.json <<'JSON'
{ "name": "shop", "version": "1.0.0", "scripts": { "dev": "vite" } }
JSON
cat > index.html <<'HTML'
<!doctype html><title>Shop</title><div id="app"></div>
<form id="login"><input name="email"><input name="password" type="password"><button>Sign in</button></form>
HTML
cat > src/checkout.js <<'JS'
export function total(items) { return items.reduce((n, i) => n + i.price, 0); }
JS
cat > src/login.js <<'JS'
export function submit(form) { return fetch("/api/login", { method: "POST", body: new FormData(form) }); }
JS
git add -A
git commit -qm "shop: checkout and login"
# Uncommitted work — this is what "my changes" refers to.
cat > src/checkout.js <<'JS'
export function total(items, coupon) {
  const sum = items.reduce((n, i) => n + i.price, 0);
  return coupon ? sum * (1 - coupon.rate) : sum;
}
JS
cat > src/login.js <<'JS'
export function submit(form) {
  const body = new FormData(form);
  return fetch("/api/login", { method: "POST", body, credentials: "include" });
}
JS
git status --short
