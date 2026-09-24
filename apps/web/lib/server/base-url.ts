/**
 * The origin the *browser* should be sent to, which is not the one the server
 * sees.
 *
 * Behind Railway (and any reverse proxy) the request arrives on an internal
 * `http://localhost:8080`, so `new URL(request.url).origin` is that internal
 * address — send an OAuth redirect there and the browser is told to go to
 * `https://localhost:8080/welcome`, which it cannot reach. The public URL is
 * the one we configured, or the one the proxy records in `x-forwarded-*`.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}
