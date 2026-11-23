import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-12">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/20 font-mono text-lg font-bold text-teal-400">
          ◆
        </span>
        <h1 className="text-xl font-bold">SignalDesk operations</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Sign in with the operator credentials from <code className="text-xs">.env</code>
        </p>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
        <LoginForm />
      </div>
    </div>
  );
}
