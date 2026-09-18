#!/usr/bin/env bash
#
# Build the program, then refresh everything generated from it.
#
# Two things here are not optional, and both fail in ways that point somewhere
# else entirely:
#
#   1. `--arch v3`. `cargo-build-sbf` defaults to `--arch v0`, and agave 4.2.2
#      no longer enables SBPFv0 execution. A default build compiles cleanly and
#      produces a `target/deploy/fomo.so` that cannot be deployed at all —
#      `solana program deploy` rejects it with "Detected sbpf_version required
#      by the executable which are not enabled". Nothing in the message mentions
#      the arch flag.
#
#   2. The IDL has to be regenerated whenever account constraints change. The
#      IDL is what tells the client which accounts are writable. Add `mut` to an
#      account in the program without refreshing the IDL and the client keeps
#      sending it read-only, so the program fails with `ConstraintMut` — which
#      reads like a program bug and is really a stale-artifact bug.
#
#   3. The web app gets its own copy of the IDL. It is the same staleness bug in
#      a different place: the app builds transactions from this file, so a copy
#      that lags the program sends the wrong accounts. Copied rather than
#      imported from `target/` because `target/` is outside the app's TypeScript
#      rootDir and Next will not bundle across that boundary.
set -euo pipefail

cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

cargo-build-sbf --arch v3 --manifest-path programs/fomo/Cargo.toml

# scripts/build-idl.mjs stands in for `anchor build`'s IDL step, which cannot run
# on this toolchain; see the header of that script.
node scripts/build-idl.mjs
anchor idl type target/idl/fomo.json -o target/types/fomo.ts

cp target/idl/fomo.json apps/web/lib/solana/fomo.idl.json

echo
echo "built target/deploy/fomo.so and refreshed the IDL + TS types"
echo "copied the IDL to apps/web/lib/solana/fomo.idl.json"
