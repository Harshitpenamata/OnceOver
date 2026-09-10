"use client";

import { use, useEffect, useRef, useState } from "react";
import { PdfViewer } from "@/components/PdfViewer";

interface ViewMeta {
  id: string;
  filename: string;
  fileType: "image" | "pdf";
  linkMode: "anyone" | "email";
  decision: "pending" | "approved" | "rejected";
  requireDecision: boolean;
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
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<ViewMeta["decision"] | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentName, setCommentName] = useState("");
  const objectUrlRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const accumulatedSecondsRef = useRef(0);
  const visibleSinceRef = useRef<number | null>(null);

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

  // Tracks how long this specific view session stays open. Only counts time
  // while the tab is visible - Page Visibility API pauses accumulation when
  // it's hidden/backgrounded, rather than trusting a single unload event
  // that mobile browsers routinely skip.
  useEffect(() => {
    if (!fileUrl || !sessionIdRef.current) return;
    const sessionId = sessionIdRef.current;

    visibleSinceRef.current = document.visibilityState === "visible" ? Date.now() : null;

    function currentElapsedSeconds() {
      const visibleMs = visibleSinceRef.current ? Date.now() - visibleSinceRef.current : 0;
      return accumulatedSecondsRef.current + visibleMs / 1000;
    }

    function sendHeartbeat() {
      fetch(`/api/view/${token}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, elapsedSeconds: currentElapsedSeconds() }),
      }).catch(() => {});
    }

    // sendBeacon (not a normal fetch) so this reliably fires during unload -
    // a fetch started here can be cancelled by the browser before it sends.
    function sendFinal() {
      const blob = new Blob([JSON.stringify({ sessionId, elapsedSeconds: currentElapsedSeconds() })], {
        type: "application/json",
      });
      navigator.sendBeacon(`/api/view/${token}/heartbeat`, blob);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        if (visibleSinceRef.current) {
          accumulatedSecondsRef.current += (Date.now() - visibleSinceRef.current) / 1000;
          visibleSinceRef.current = null;
        }
      } else {
        visibleSinceRef.current = Date.now();
      }
    }

    const interval = setInterval(sendHeartbeat, 7000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", sendFinal);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", sendFinal);
      sendFinal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  async function loadComments() {
    const res = await fetch(`/api/view/${token}/comments`);
    if (res.ok) setComments((await res.json()).comments);
  }

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/view/${token}/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identity.trim() }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not send a code");
      return;
    }
    setCodeSent(true);
  }

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(`/api/view/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:
        meta?.linkMode === "email"
          ? JSON.stringify({ email: identity.trim(), code: code.trim() })
          : JSON.stringify({ viewerIdentity: identity.trim() || "Anonymous" }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "This file could not be opened");
      setLoading(false);
      return;
    }

    sessionIdRef.current = res.headers.get("X-View-Session-Id");
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
    const isEmailStep2 = meta.linkMode === "email" && codeSent;

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <form
          onSubmit={isEmailStep2 ? handleOpen : meta.linkMode === "email" ? handleRequestCode : handleOpen}
          className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8"
        >
          <h1 className="text-lg font-semibold text-white">{meta.filename}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            This file is watermarked with your name and the time you open it.
          </p>
          {meta.linkMode === "email" ? (
            <p className="mt-2 text-sm text-amber-400">
              This link only opens for the email addresses it was sent to - we&apos;ll email you
              a code to confirm.
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              This isn&apos;t verified - enter whatever identifies you to the sender.
            </p>
          )}

          {isEmailStep2 ? (
            <>
              <label className="mt-6 block text-sm font-medium text-zinc-300">
                Code sent to {identity}
              </label>
              <input
                autoFocus
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-center text-lg tracking-[0.5em] text-white outline-none focus:border-zinc-400"
              />
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
                className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-300"
              >
                Use a different email
              </button>
            </>
          ) : (
            <>
              <label className="mt-6 block text-sm font-medium text-zinc-300">
                {meta.linkMode === "email" ? "Your email" : "Your name or email"}
              </label>
              <input
                autoFocus
                required
                type={meta.linkMode === "email" ? "email" : "text"}
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="jane@example.com"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-400"
              />
            </>
          )}

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {loading
              ? isEmailStep2
                ? "Verifying..."
                : "Sending..."
              : isEmailStep2
                ? "View file"
                : meta.linkMode === "email"
                  ? "Send code"
                  : "View file"}
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
        {meta.requireDecision && (
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
        )}
      </header>

      <main
        className="flex flex-1 select-none items-center justify-center overflow-auto p-6"
        onDragStart={(e) => e.preventDefault()}
        style={{ userSelect: "none" }}
      >
        {meta.fileType === "image" ? (
          <img src={fileUrl} alt="Shared file" draggable={false} className="max-h-[80vh] max-w-full rounded-lg shadow-2xl" />
        ) : (
          <PdfViewer fileUrl={fileUrl} />
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
