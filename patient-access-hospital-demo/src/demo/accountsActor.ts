import { Agent, rpc, type Env } from "@telnyx/edge-runtime";
import { hashPassword, normalizeEmail, seedAccount, validateSignup, verifyPassword, type AccountRecord } from "@/demo/accounts";

// AccountsActor: the auth gate for the demo portal. Holds synthetic staff
// accounts (salted+hashed) and active sessions in durable actor state so
// sign-ups/sign-ins survive restarts.

export type AccountsState = {
  users: AccountRecord[];
  sessions: Array<{ token: string; email: string; expiresAtIso: string }>;
  loginFailures?: { count: number; lockedUntilIso?: string };
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export class AccountsActor extends Agent<Env, AccountsState> {
  protected override initialState(): AccountsState {
    const seed = seedAccount();
    return {
      users: [
        {
          email: seed.email,
          salt: seed.salt,
          hash: seed.hash,
          createdAtIso: new Date().toISOString(),
        },
      ],
      sessions: [],
    };
  }

  private async openSession(email: string): Promise<string> {
    const token = crypto.randomUUID();
    const expiresAtIso = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const current = await this.getState();
    await this.replaceState({ ...current, sessions: [...current.sessions, { token, email, expiresAtIso }] });
    return token;
  }

  @rpc({ description: "Create a synthetic staff account and sign in" })
  async signUp(input: { email: string; password: string; confirm?: string }): Promise<
    { ok: true; token: string; email: string } | { ok: false; error: string }
  > {
    const check = validateSignup(input);
    if (!check.ok) return { ok: false, error: check.error };
    const users = (await this.getState()).users;
    if (users.some((u) => u.email === check.email)) {
      return { ok: false, error: "An account with that email already exists — sign in instead." };
    }
    const derived = hashPassword(input.password);
    await this.replaceState({
      ...(await this.getState()),
      users: [...users, { email: check.email, salt: derived.salt, hash: derived.hash, createdAtIso: new Date().toISOString() }],
    });
    return { ok: true, token: await this.openSession(check.email), email: check.email };
  }

  @rpc({ description: "Verify credentials and open a session" })
  async signIn(input: { email: string; password: string }): Promise<
    { ok: true; token: string; email: string } | { ok: false; error: string; rateLimited?: boolean }
  > {
    const current = await this.getState();
    const now = Date.now();
    const lockout = current.loginFailures?.lockedUntilIso ? Date.parse(current.loginFailures.lockedUntilIso) : 0;
    if (lockout > now) return { ok: false, error: "Too many failed sign-in attempts — try again later.", rateLimited: true };
    const email = normalizeEmail(input.email ?? "");
    const user = current.users.find((u) => u.email === email);
    if (!user || typeof input.password !== "string" || !verifyPassword(user, input.password)) {
      const failures = (current.loginFailures?.count ?? 0) + 1;
      await this.replaceState({
        ...current,
        loginFailures: failures >= LOGIN_FAILURE_LIMIT
          ? { count: failures, lockedUntilIso: new Date(now + LOGIN_LOCKOUT_MS).toISOString() }
          : { count: failures },
      });
      return {
        ok: false,
        error: failures >= LOGIN_FAILURE_LIMIT ? "Too many failed sign-in attempts — try again later." : "Invalid email or password.",
        rateLimited: failures >= LOGIN_FAILURE_LIMIT,
      };
    }
    if (current.loginFailures) await this.replaceState({ ...current, loginFailures: { count: 0 } });
    return { ok: true, token: await this.openSession(user.email), email: user.email };
  }

  @rpc({ description: "Resolve a session token to its account" })
  async checkToken(token: string): Promise<{ authed: boolean; email?: string }> {
    const nowIso = new Date().toISOString();
    const sessions = (await this.getState()).sessions.filter((s) => s.expiresAtIso > nowIso);
    const found = sessions.find((s) => s.token === token);
    if (!found) return { authed: false };
    return { authed: true, email: found.email };
  }

  @rpc({ description: "Close a session token" })
  async signOut(token: string): Promise<void> {
    const current = await this.getState();
    await this.replaceState({ ...current, sessions: current.sessions.filter((x) => x.token !== token) });
  }
}
