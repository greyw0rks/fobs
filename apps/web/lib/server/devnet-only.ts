/**
 * The gate that keeps devnet-only machinery out of a production deployment.
 *
 * Two separate things need it — signing as a seeded test user, and holding the
 * mint authority to fund wallets — and they must answer the question the same
 * way. Two copies of this rule would eventually disagree, and the way they would
 * disagree is that one of them would be wrong.
 *
 * Default-deny: `next start` sets NODE_ENV=production, and under that these
 * paths are closed unless someone has set FOBS_ALLOW_TEST_SIGNING=1, which is
 * loud, greppable, and warned about on every use.
 */

export function isProduction(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.FOBS_ALLOW_TEST_SIGNING === "1") {
    console.warn(
      "[fobs] FOBS_ALLOW_TEST_SIGNING=1 in a production build — this deployment can " +
        "sign devnet transactions as seeded test users and can fund wallets. This " +
        "must not be set on anything holding real value."
    );
    return false;
  }
  return true;
}
