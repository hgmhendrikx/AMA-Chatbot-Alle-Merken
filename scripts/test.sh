#!/usr/bin/env bash
# Draait alle tests. Geen API-sleutels nodig: OpenAI, Pinecone, ElevenLabs en Supabase worden nagebootst.
#   Vereist: deno, python3 met playwright + jinja2 (en een Chromium: python -m playwright install chromium)
#   ./scripts/test.sh          alles
#   ./scripts/test.sh edge     alleen de Edge Functions
#   ./scripts/test.sh ui       alleen de browsertest
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-all}" != "ui" ]]; then
  echo "== Typecheck Edge Functions"
  deno check supabase/functions/*/index.ts
  for t in tests/edge/*_test.ts; do
    echo "== $t"
    deno run -A "$t" | grep -v '^\[' # serverlogs verbergen
  done
fi

if [[ "${1:-all}" != "edge" ]]; then
  echo "== Browsertest"
  python3 tests/ui/test_site.py
fi
