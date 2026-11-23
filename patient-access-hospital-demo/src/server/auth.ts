// Session cookie plumbing for the demo portal. Session tokens live in the
// AccountsActor's durable state; the browser only ever holds an HttpOnly
// cookie.

export const SESSION_COOKIE = "pa_session";

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length > 0) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function sessionCookie(token: string, secure = true): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure = true): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
