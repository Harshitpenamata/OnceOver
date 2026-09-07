"use client";

import { use, useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { StatusBadge } from "@/components/StatusBadge";
import type { Share, ShareComment, ShareView } from "@/lib/types";

export default function ShareDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [share, setShare] = useState<Share | null>(null);
  const [views, setViews] = useState<ShareView[]>([]);
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/s/` : "";

  // Deliberately returns data rather than calling setState itself: an effect
  // is only allowed to call setState from its own body/callback, not from a
  // named function it invokes, so the fetch is shared while each call site
  // (the mount effect, the post-reply refresh) applies the result itself.
  async function fetchShareData() {
    const res = await fetch(`/api/shares/${id}`);
    return res.ok ? res.json() : null;
  }

  useEffect(() => {
    fetchShareData().then((data) => {
      if (!data) return;
      setShare(data.share);
      setViews(data.views);
      setComments(data.comments);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    const res = await fetch(`/api/shares/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    setSending(false);
    if (res.ok) {
      setReply("");
      const data = await fetchShareData();
      if (data) {
        setShare(data.share);
        setViews(data.views);
        setComments(data.comments);
      }
    }
  }

  if (!share) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50">
        <AppNav />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 text-zinc-500">Loading...</main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <AppNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">{share.original_filename}</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Created {new Date(share.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <StatusBadge label={share.status} />
              <StatusBadge label={share.decision} />
            </div>
          </div>

          {share.status === "active" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <code className="flex-1 truncate text-sm text-zinc-700">
                {shareUrl}
                {share.token}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(`${shareUrl}${share.token}`)}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                Copy
              </button>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Views</dt>
              <dd className="font-medium text-zinc-900">
                {share.view_count}
                {share.max_views ? ` / ${share.max_views}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Expires</dt>
              <dd className="font-medium text-zinc-900">
                {share.expires_at ? new Date(share.expires_at).toLocaleString() : "No time limit"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Access</dt>
              <dd className="font-medium text-zinc-900">
                {share.link_mode === "email" ? share.recipient_email : "Anyone with the link"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-900">View activity</h2>
          {views.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nobody has opened this file yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {views.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-zinc-800">{v.viewer_identity}</span>
                  <span className="text-zinc-500">{new Date(v.viewed_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-zinc-900">Comments</h2>
          <div className="mt-3 flex flex-col gap-3">
            {comments.length === 0 && <p className="text-sm text-zinc-500">No comments yet.</p>}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  c.author_type === "sender" ? "self-end bg-zinc-900 text-white" : "self-start bg-zinc-100 text-zinc-800"
                }`}
              >
                <p className="text-xs font-medium opacity-70">{c.author_name}</p>
                <p>{c.body}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleReply} className="mt-4 flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply..."
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
