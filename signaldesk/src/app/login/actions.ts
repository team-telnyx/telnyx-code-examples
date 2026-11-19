"use server";

import { signIn } from "@/auth";
import { AuthError } from "@auth/core/errors";
import { z } from "zod";

const loginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});

export async function loginAction(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return "Enter a username and password.";
  }

  try {
    await signIn("credentials", {
      username: parsed.data.username,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid username or password.";
    }
    throw error;
  }
  return null;
}
