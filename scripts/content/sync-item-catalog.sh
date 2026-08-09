#!/usr/bin/env bash
# Sync data/content/items.design.json → public/assets/items/item-catalog.json (runtime subset)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DESIGN="$ROOT/data/content/items.design.json"
OUT="$ROOT/public/assets/items/item-catalog.json"

jq '{
  schemaVersion: 1,
  dropRules: .dropRules,
  crate: (.crate | del(.trellisPrompt)),
  trails: .trails,
  wheels: (.wheels | map(del(.trellisPrompt))),
  toppers: (.toppers | map(del(.trellisPrompt))),
  decals: .decals,
  goalExplosions: .goalExplosions
}' "$DESIGN" >"$OUT"
echo "OK: $OUT"
