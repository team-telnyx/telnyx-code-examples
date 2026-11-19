import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isDev } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SignalDesk — SMS incident operations",
  description:
    "AI incident-response over Telnyx SMS: inbound reports, structured triage, and subscriber updates.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const dev = isDev();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 bg-zinc-900/50">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-teal-500/20 font-mono text-sm font-bold text-teal-400">
                ◆
              </span>
              <span className="text-sm font-semibold tracking-tight">SignalDesk</span>
              <span className="hidden rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400 sm:inline">
                incident ops
              </span>
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {dev && (
                <>
                  <Link
                    href="/dev/simulator"
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500 hover:text-white"
                  >
                    Simulator
                  </Link>
                  <Link
                    href="/dev/outbox"
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500 hover:text-white"
                  >
                    Outbox
                  </Link>
                </>
              )}
              {session?.user ? (
                <form action={handleSignOut}>
                  <button
                    type="submit"
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-zinc-500 hover:text-white"
                  >
                    Sign out
                  </button>
                </form>
              ) : (
                <Link
                  href="/login"
                  className="rounded bg-teal-600 px-2.5 py-1 font-medium text-white hover:bg-teal-500"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-zinc-900 py-4 text-center text-xs text-zinc-600">
          SignalDesk MVP — Telnyx Messaging + AI Gateway (zai/glm-5.3-flash → Telnyx)
        </footer>
      </body>
    </html>
  );
}
