#!/usr/bin/env bash
set -e

npm run build

REMOTE=$(git remote get-url origin)

cd build
git init -q -b pages
git add -A
git commit -q -m "deploy"
git push -f "$REMOTE" pages

echo "Deployed."
