import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { decodeIntent, encodeIntent, type OAuthIntent } from "./oauth-intent";

/**
 * Google sign-in — OpenID Connect, authorization code flow with PKCE.
 *
 * Deliberately the same shape as `x-oauth.ts`, down to the cookie names being
 * separately prefixed. Two providers, one pattern: if you have read one of these
 * files you have read both, and the second one is not a place to be clever.
 *
 * PKCE as well as the client secret. Google is a confidential client and the
 * secret would be enough on its own, but the code exchange happens server-side
 * either way and PKCE costs nothing — while removing the class of attack where an
 * intercepted code is redeemed by whoever grabbed it.
 *
 * The client secret is still required: unlike X, Google's token endpoint
 * expects it, so `googleConfigured()` demands both.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * `openid` for the ID token, `email` and `profile` for a name and an avatar.
 * Nothing here asks for anything the app does not render, and there is no
 * offline access — FOBS never acts on a Google account after sign-in.
 */
const SCOPES = ["openid", "email", "profile"];

const VERIFIER_COOKIE = "fobs_g_verifier";
const STATE_COOKIE = "fobs_g_state";
const INTENT_COOKIE = "fobs_g_intent";

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_CALLBACK_URL
  );
}

/**
 * What the user is trying to do, carried through the redirect. See
 * `oauth-intent.ts` — it is shared with the X flow rather than owned here.
 */
export type { OAuthIntent };

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export type AuthorizeStart = {
  url: string;
  verifier: string;
  state: string;
  intent: OAuthIntent;
};

export function authorizeStart(intent: OAuthIntent): AuthorizeStart {
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_CALLBACK_URL!);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Google issues a refresh token unless told not to; FOBS never uses one, and
  // asking for one would be asking for a standing grant it cannot justify.
  url.searchParams.set("access_type", "online");
  // Without this, a user who is already signed into one Google account is
  // silently signed into that one, which makes "link a different account"
  // impossible to reach.
  url.searchParams.set("prompt", "select_account");

  return { url: url.toString(), verifier, state, intent };
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
  store.set(INTENT_COOKIE, encodeIntent(flow.intent), TRANSIENT);
}

export async function readFlowCookies(): Promise<{
  verifier: string | null;
  state: string | null;
  intent: OAuthIntent | null;
}> {
  const store = await cookies();
  return {
    verifier: store.get(VERIFIER_COOKIE)?.value ?? null,
    state: store.get(STATE_COOKIE)?.value ?? null,
    intent: decodeIntent(store.get(INTENT_COOKIE)?.value ?? null)
  };
}

export async function clearFlowCookies() {
  const store = await cookies();
  store.delete(VERIFIER_COOKIE);
  store.delete(STATE_COOKIE);
  store.delete(INTENT_COOKIE);
}

export type GoogleProfile = {
  /** Google's stable subject id. Never the email — an email can be reassigned. */
  id: string;
  email: string | null;
  name: string;
  avatar: string | null;
};

/**
 * Exchange the code and read the profile.
 *
 * Reads the OIDC userinfo endpoint rather than decoding the ID token, so there
 * is no JWT verification to get wrong: the token was obtained over TLS directly
 * from Google in the line above, and the userinfo call is authenticated with it.
 * Verifying a self-issued token to learn what it already told us would be
 * ceremony, not security.
 */
export async function exchangeCode(input: {
  code: string;
  verifier: string;
}): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
    code_verifier: input.verifier,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!
  });

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `Google token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`
    );
  }
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Google token exchange returned no access token");

  const infoResponse = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}` }
  });
  if (!infoResponse.ok) {
    throw new Error(
      `Google profile lookup failed (${infoResponse.status}): ${await infoResponse.text()}`
    );
  }
  const payload = (await infoResponse.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!payload.sub) throw new Error("Google profile lookup returned no subject id");

  return {
    id: payload.sub,
    email: payload.email ?? null,
    // A Google account with no display name is unusual but not impossible;
    // falling back to the email keeps `displayName` non-empty, as the schema
    // requires, without inventing a name.
    name: payload.name || payload.email || "Google user",
    avatar: payload.picture ?? null
  };
}
