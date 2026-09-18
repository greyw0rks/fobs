/**
 * Devnet's public RPC is not a private one.
 *
 * It rate-limits hard — a burst of reads comes back `429` — and several of the
 * SPL helpers confirm a transaction and then read the account straight back, a
 * read that can land before the write is visible. Both surface as errors that
 * look like bugs in whatever called them (`TokenAccountNotFoundError` is the
 * usual one) and are really just timing.
 *
 * Retrying is safe for the calls that use this because all of them are
 * create-if-missing: running one twice converges rather than compounding.
 */

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const wait = 500 * 2 ** (attempt - 1);
      console.log(`  ${label}: attempt ${attempt} failed, retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastError;
}
