"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AppNav() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
      <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-zinc-900">
        OnceOver
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/dashboard" className="text-zinc-600 hover:text-zinc-900">
          Dashboard
        </Link>
        <Link
          href="/upload"
          className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700"
        >
          New share
        </Link>
        <button onClick={handleLogout} className="text-zinc-600 hover:text-zinc-900">
          Log out
        </button>
      </nav>
    </header>
  );
}
