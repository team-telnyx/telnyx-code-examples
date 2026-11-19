import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getOperatorPasswordHash, getOperatorUsername } from "@/lib/config";
import { verifyPasswordHash } from "@/lib/password";

/**
 * Password-based operator auth (Auth.js Credentials provider).
 *
 * A single operator account is provisioned through environment variables:
 *   SIGNALDESK_OPERATOR_USERNAME + SIGNALDESK_OPERATOR_PASSWORD_HASH
 * Generate the hash with `npm run hash-password -- <password>`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials) => {
        const parsed = z
          .object({
            username: z.string().min(1).max(120),
            password: z.string().min(1).max(200),
          })
          .safeParse(credentials);
        if (!parsed.success) return null;

        const expectedUsername = getOperatorUsername();
        const expectedHash = getOperatorPasswordHash();

        const usernameOk =
          parsed.data.username.trim().toLowerCase() ===
          expectedUsername.trim().toLowerCase();
        const passwordOk = verifyPasswordHash(expectedHash, parsed.data.password);

        if (!usernameOk || !passwordOk) return null;
        return { id: expectedUsername, name: expectedUsername };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  trustHost: true,
});
