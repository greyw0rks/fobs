import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * X (Twitter) OAuth 2.0 with PKCE.
 *
 * PKCE rather than a client secret in the browser: the code exchange happens on
 * the server here, so a confidential client would also work, but PKCE is what
 * the flow is designed around and it means the app is not broken by a leaked
 * "public" client id.
 *
 * `code_verifier` and `state` are held in short-lived httpOnly cookies rather
 * than in a server-side store. They are single-use and live for minutes, so the
 * cookie is the right shape for them — and holding them server-side would mean
 * the flow could not complete across a dev-server restart.
 */

const AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const ME_URL = "https://api.twitter.com/2/users/me";

/** users.read identifies them; we never read their X follow graph — ours is our own. */
const SCOPES = ["users.read", "tweet.read"];

const VERIFIER_COOKIE = "fobs_x_verifier";
const STATE_COOKIE = "fobs_x_state";

export function xConfigured(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_CALLBACK_URL);
}

/**
 * The dev fallback exists because the whole test environment is real devnet
 * users, and requiring live X credentials to sign in as one of them would make
 * the harness unusable. It is gated on the same rule as test-user signing: in a
 * production build it cannot be reached at all, with one loud, greppable
 * override for demoing a production build on purpose.
 */
export function devSignInAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.FOBS_ALLOW_TEST_SIGNING === "1";
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export type AuthorizeStart = { url: string; verifier: string; state: string };

export function authorizeStart(): AuthorizeStart {
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.X_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.X_CALLBACK_URL!);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), verifier, state };
}

const TRANSIENT = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600
};

export async function storeFlowCookies(flow: AuthorizeStart) {
  const store = await cookies();
  store.set(VERIFIER_COOKIE, flow.verifier, TRANSIENT);
  store.set(STATE_COOKIE, flow.state, TRANSIENT);
}

export async function readFlowCookies() {
  const store = await cookies();
  return {
    verifier: store.get(VERIFIER_COOKIE)?.value ?? null,
    state: store.get(STATE_COOKIE)?.value ?? null
  };
}

export async function clearFlowCookies() {
  const store = await cookies();
  store.delete(VERIFIER_COOKIE);
  store.delete(STATE_COOKIE);
}

export type XProfile = {
  id: string;
  username: string;
  name: string;
  avatar: string | null;
};

/**
 * Exchange the code for a token, then read the profile.
 *
 * X requires the verifier it was challenged with, so a mismatch here is a
 * genuine security failure (someone replaying a code) and is thrown as one
 * rather than retried.
 */
export async function exchangeCode(input: {
  code: string;
  verifier: string;
}): Promise<XProfile> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: process.env.X_CALLBACK_URL!,
    code_verifier: input.verifier,
    client_id: process.env.X_CLIENT_ID!
  });

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `X token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`
    );
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("X token exchange returned no access token");

  const meResponse = await fetch(`${ME_URL}?user.fields=profile_image_url`, {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  if (!meResponse.ok) {
    throw new Error(
      `X profile lookup failed (${meResponse.status}): ${await meResponse.text()}`
    );
  }
  const payload = (await meResponse.json()) as {
    data?: { id: string; username: string; name: string; profile_image_url?: string };
  };
  if (!payload.data) throw new Error("X profile lookup returned no user");

  return {
    id: payload.data.id,
    username: payload.data.username,
    name: payload.data.name || payload.data.username,
    avatar: payload.data.profile_image_url ?? null
  };
}
