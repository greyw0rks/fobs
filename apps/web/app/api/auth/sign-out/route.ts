import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, destroySession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Sign out.
 *
 * Deletes the row as well as the cookie. Clearing only the cookie would leave a
 * live session id that anyone who captured it could still use — which is the
 * entire reason sessions are rows.
 *
 * POST, not GET. This used to be a GET reached by a link in the nav, which meant
 * any page on the internet could end your session with `<img
 * src="https://…/api/auth/sign-out">`. The damage is small — you get logged out
 * — but a state change behind a GET is a state change a browser will happily
 * make on a third party's behalf, and the fix is one word. Every caller is a
 * form now.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(id);

  const response = NextResponse.redirect(new URL("/", new URL(request.url).origin), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/**
 * A GET here is refused rather than honoured, with a body that says what to do.
 * Returning 405 rather than silently signing the user out is the point: a stray
 * prefetch or an old bookmark should not end a session, and it should be obvious
 * why nothing happened. There is deliberately no query-parameter escape hatch —
 * a GET that signs you out when asked nicely is still a GET that signs you out.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Sign-out is a POST. A GET can be triggered by any page on any site." },
    { status: 405, headers: { allow: "POST" } }
  );
}
