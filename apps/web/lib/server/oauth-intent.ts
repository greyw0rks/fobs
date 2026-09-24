/**
 * What the user is trying to do when they leave for an identity provider.
 *
 * Both OAuth flows (`x-oauth.ts`, `google-oauth.ts`) need this, and neither owns
 * it: it is the one piece of the redirect that is about FOBS rather than about
 * the provider.
 *
 * The reason it has to travel at all is that the callback arrives as a bare
 * redirect with no context — no session on a first sign-in, and no way to tell
 * "sign in as this person" from "attach this identity to the person already
 * signed in". That distinction is the whole difference between linking and
 * account-switching, so it is carried in the flow's own cookie rather than
 * guessed at the other end.
 *
 * It is *not* carried in the `state` parameter. `state` is the CSRF defence and
 * its only job is to match the cookie byte for byte; putting the intent inside
 * it would mean either trusting a parse of the very value being checked, or
 * checking a value that has been rewritten in transit. Two cookies, two jobs.
 */

export type OAuthIntent = { kind: "sign-in" } | { kind: "link"; userId: string };

export function encodeIntent(intent: OAuthIntent): string {
  return intent.kind === "link" ? `link:${intent.userId}` : "sign-in";
}

export function decodeIntent(raw: string | null): OAuthIntent | null {
  if (!raw) return null;
  if (raw === "sign-in") return { kind: "sign-in" };
  if (raw.startsWith("link:")) {
    const userId = raw.slice("link:".length);
    return userId ? { kind: "link", userId } : null;
  }
  // An unrecognised intent is refused rather than defaulted to `sign-in`.
  // Defaulting would mean a corrupted cookie silently turns "link this account"
  // into "sign in as this account", which is a worse outcome than an error.
  return null;
}
