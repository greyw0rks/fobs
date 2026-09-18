#!/usr/bin/env bash
#
# Run the on-chain suite against a local validator this script owns.
#
# `anchor test` does the same thing, and is the right default. This exists
# because it makes two things visible that `anchor test` hides, and both of them
# have already produced a confusing failure in this repo:
#
#   - Which ledger is in play. `anchor test` may attach to a validator that is
#     already listening on the RPC port, and a validator that still holds a
#     previously deployed program will happily run the whole suite against
#     bytecode that has nothing to do with the source you just edited.
#   - Whether the program on chain is the artifact you built. This script dumps
#     the deployed program and diffs it against target/deploy/fomo.so, so
#     "the program disagreed with my test" can be answered immediately instead
#     of after an afternoon of seed arithmetic.
#
# Usage:
#   scripts/test-onchain.sh          start a validator, deploy, run the suite
#   scripts/test-onchain.sh stop     stop the validator this script started
set -uo pipefail

cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

PIDFILE=/tmp/fobs-validator.pid
LEDGER=/tmp/fobs-test-ledger
URL=http://127.0.0.1:8899
PROGRAM_ID=Fomo9DbW4wbTRSz9eU82Tp1HH27LQJPUYZzcZoSKonxL

stop_validator() {
  if [[ -f $PIDFILE ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    sleep 2
  fi
}

if [[ "${1:-run}" == "stop" ]]; then
  stop_validator
  echo "validator stopped"
  exit 0
fi

if [[ ! -f target/deploy/fomo.so ]]; then
  echo "target/deploy/fomo.so is missing. Run: pnpm build:program" >&2
  exit 1
fi

stop_validator
rm -rf "$LEDGER"

solana-test-validator --reset --ledger "$LEDGER" --quiet >/tmp/fobs-validator.log 2>&1 &
echo $! >"$PIDFILE"

for _ in $(seq 1 30); do
  if curl -s -m 2 -X POST "$URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"result":"ok"'; then
    break
  fi
  sleep 1
done
echo "validator up (pid "$(cat "$PIDFILE")")"

solana config set --url "$URL" >/dev/null 2>&1
solana airdrop 500 >/dev/null 2>&1

solana program deploy target/deploy/fomo.so \
  --program-id target/deploy/fomo-keypair.json --url "$URL" >/tmp/fobs-deploy.log 2>&1

if ! grep -q 'Program Id:' /tmp/fobs-deploy.log; then
  echo "deploy failed:" >&2
  tail -20 /tmp/fobs-deploy.log >&2
  exit 1
fi

solana program dump -u "$URL" "$PROGRAM_ID" /tmp/fobs-onchain.so >/dev/null 2>&1
if cmp -s /tmp/fobs-onchain.so target/deploy/fomo.so; then
  echo "onchain bytecode matches target/deploy/fomo.so"
else
  echo "the deployed program is NOT the artifact that was just built:" >&2
  echo "  local:   $(stat -c%s target/deploy/fomo.so) bytes" >&2
  echo "  onchain: $(stat -c%s /tmp/fobs-onchain.so) bytes" >&2
  exit 1
fi

export ANCHOR_PROVIDER_URL="$URL"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"

pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/fomo.ts
