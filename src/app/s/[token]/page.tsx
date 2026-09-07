"use client";

import { use, useEffect, useRef, useState } from "react";

interface ViewMeta {
  id: string;
  filename: string;
  fileType: "image" | "pdf";
  linkMode: "anyone" | "email";
  decision: "pending" | "approved" | "rejected";
  expired: boolean;
  viewCount: number;
  maxViews: number | null;
  expiresAt: string | null;
}

interface Comment {
  id: string;
  author_type: "sender" | "recipient";
  author_name: string;
  body: string;
  created_at: string;
}

export default function ViewerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [meta, setMeta] = useState<ViewMeta | null>(null);
  const [identity, setIdentity] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<ViewMeta["decision"] | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentName, setCommentName] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    fetch(`/api/view/${token}`)
      .then((r) => r.json())
      .then((data) => {
        setMeta(data);
        setDecision(data.decision);
      });
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [token]);

  useEffect(() => {
    if (!fileUrl) return;
    loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  async function loadComments() {
    const res = await fetch(`/api/view/${token}/comments`);
    if (res.ok) setComments((await res.json()).comments);
  }

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/view/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerIdentity: identity.trim() || "Anonymous" }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "This file could not be opened");
      setLoading(false);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    setFileUrl(url);
    setCommentName(identity.trim() || "Anonymous");
    setLoading(false);
  }

  async function handleDecision(next: "approved" | "rejected") {
    if (!meta) return;
    const res = await fetch(`/api/shares/${meta.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, decision: next }),
    });
    if (res.ok) setDecision(next);
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    const res = await fetch(`/api/view/${token}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorName: commentName || "Recipient", body: commentBody }),
    });
    if (res.ok) {
      setCommentBody("");
      loadComments();
    }
  }

  if (!meta) {
    return <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">Loading...</div>;
  }

  if (meta.expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <h1 className="text-lg font-semibold text-white">This file is no longer available</h1>
          <p className="mt-2 text-sm text-zinc-400">
            It expired or reached its view limit and has been permanently deleted.
          </p>
        </div>
      </div>
    );
  }

  if (!fileUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <form
          onSubmit={handleOpen}
          className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8"
        >
          <h1 className="text-lg font-semibold text-white">{meta.filename}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            This file is watermarked with your name and the time you open it.
          </p>
          <label className="mt-6 block text-sm font-medium text-zinc-300">Your name or email</label>
          <input
            autoFocus
            required
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="jane@example.com"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          />
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading ? "Opening..." : "View file"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-zinc-950 [-webkit-touch-callout:none]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <span className="text-sm font-medium text-zinc-200">{meta.filename}</span>
        <div className="flex gap-2">
          <button
            onClick={() => handleDecision("approved")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              decision === "approved" ? "bg-emerald-500 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Approve
          </button>
          <button
            onClick={() => handleDecision("rejected")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              decision === "rejected" ? "bg-red-500 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            Reject
          </button>
        </div>
      </header>

      <main
        className="flex flex-1 select-none items-center justify-center overflow-auto p-6"
        onDragStart={(e) => e.preventDefault()}
        style={{ userSelect: "none" }}
      >
        {meta.fileType === "image" ? (
          <img src={fileUrl} alt="Shared file" draggable={false} className="max-h-[80vh] max-w-full rounded-lg shadow-2xl" />
        ) : (
          <iframe src={`${fileUrl}#toolbar=0`} className="h-[80vh] w-full max-w-3xl rounded-lg bg-white" />
        )}
      </main>

      <section className="border-t border-zinc-800 bg-zinc-900 px-6 py-4">
        <h2 className="text-sm font-semibold text-zinc-200">Comments</h2>
        <div className="mt-2 flex max-h-40 flex-col gap-2 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="text-sm text-zinc-300">
              <span className="font-medium text-zinc-100">{c.author_name}:</span> {c.body}
            </div>
          ))}
        </div>
        <form onSubmit={handleComment} className="mt-3 flex gap-2">
          <input
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Leave feedback..."
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
          />
          <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
