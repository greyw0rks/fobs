/**
 * A message for an error that is always worth printing.
 *
 * `error instanceof Error ? error.message : String(error)` is the idiom this
 * codebase uses everywhere, and it has a hole: some error classes carry an empty
 * message. `TokenOwnerOffCurveError` from `@solana/spl-token` is one — it has a
 * name and no text — so the idiom prints a blank line, the process exits 1, and
 * the screen shows nothing at all. That is indistinguishable from the shell
 * killing the script, and it costs more time to diagnose than any wrong number
 * would.
 *
 * The name is the fallback because it is the part that is never empty, and it is
 * usually the part that identifies the problem.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().length > 0 ? error.message : error.name;
  }
  return String(error);
}
