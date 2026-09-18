#!/usr/bin/env bash
# Dev launcher for FOBS web. Kept in a script so process-matching patterns
# don't collide with the invoking shell's own argv.
set -u
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/next dev
