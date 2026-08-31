#!/usr/bin/env bash
# Unified build for a single Vercel deployment serving both apps/admin
# (at the site root, "/") and apps/staff (under "/staff/*"), sharing one
# Supabase-backed database/session model, one domain.
set -euo pipefail

echo "==> Building admin (base: /)"
VITE_BASE_PATH="/" npm run build --workspace=apps/admin

echo "==> Building staff (base: /staff/)"
VITE_BASE_PATH="/staff/" npm run build --workspace=apps/staff

echo "==> Assembling unified output"
rm -rf unified-dist
mkdir -p unified-dist
cp -r apps/admin/dist/. unified-dist/
mkdir -p unified-dist/staff
cp -r apps/staff/dist/. unified-dist/staff/

echo "==> Done. unified-dist/ contains both apps."
