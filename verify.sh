#!/usr/bin/env bash
# verify.sh — the Definition of Done, mechanised.
#
#   1. type-check and unit tests pass
#   2. the demo replays byte-identically (stdout AND every ledger and log) across two
#      runs — the accounting analogue of starship's replay proof: the books close to
#      the same balances twice.
#
# Run from anywhere: ./verify.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "== deno check =="
deno check src/**/*.ts

echo "== deno test =="
deno test --allow-read --allow-write

echo "== determinism: two demo runs must be byte-identical =="
books() {
  cat demo-out/books/ledger.json demo-out/books/journal.jsonl demo-out/books/intent-log.jsonl \
      demo-out/alarm/journal.jsonl demo-out/alarm/intent-log.jsonl \
      demo-out/sub-a/ledger.json demo-out/sub-b/ledger.json
}

OUT1="$(deno run --allow-read --allow-write src/demo.ts)"; A="$(books)"
OUT2="$(deno run --allow-read --allow-write src/demo.ts)"; B="$(books)"

if [[ "$OUT1" == "$OUT2" && "$A" == "$B" ]]; then
  echo "PASS: stdout, ledgers and logs are byte-identical across two runs."
else
  echo "FAIL: replay is not deterministic." >&2
  exit 1
fi
