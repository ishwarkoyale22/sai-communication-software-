#!/usr/bin/env bash
# Single-app build: Admin Panel and Staff Portal now live in one React app
# (apps/admin) sharing one login page and one router, split only by
# role-gated routes ("/" = admin, "/portal" = staff) — see apps/admin/src/App.tsx.
# apps/staff is no longer part of the deployed site (superseded by
# apps/admin/src/staff/*); its source is kept for reference only.
set -euo pipefail

echo "==> Building admin (includes Staff Portal at /portal)"
npm run build --workspace=apps/admin

echo "==> Assembling output"
rm -rf unified-dist
mkdir -p unified-dist
cp -r apps/admin/dist/. unified-dist/

echo "==> Done. unified-dist/ contains the single unified app."
