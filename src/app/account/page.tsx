"use client";

import { useState } from "react";
import { AppNav } from "@/components/AppNav";
import { createClient } from "@/lib/supabase/client";

export default function AccountPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPassword("");
    setConfirm("");
    setSuccess(true);
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <AppNav />
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Account</h1>
        <p className="mt-1 text-sm text-zinc-500">Change your password.</p>

        <form
          onSubmit={handleSubmit}
          className="mt-6 flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6"
        >
          <div>
            <label className="block text-sm font-medium text-zinc-700">New password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Confirm new password</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-emerald-600">Password updated.</p>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Update password"}
          </button>
        </form>
      </main>
    </div>
  );
}
