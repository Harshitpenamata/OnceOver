"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { EXPIRY_PRESETS } from "@/lib/expiry";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [expiryChoice, setExpiryChoice] = useState<string>("24");
  const [customHours, setCustomHours] = useState("");
  const [useViewLimit, setUseViewLimit] = useState(false);
  const [maxViews, setMaxViews] = useState("1");
  const [linkMode, setLinkMode] = useState<"anyone" | "email">("anyone");
  const [recipientEmailsText, setRecipientEmailsText] = useState("");
  const [requireDecision, setRequireDecision] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Choose a file to share");
      return;
    }
    const recipientEmails = recipientEmailsText
      .split(/[\n,]/)
      .map((email) => email.trim())
      .filter(Boolean);
    if (linkMode === "email" && recipientEmails.length === 0) {
      setError("Enter at least one recipient email");
      return;
    }

    const expiresInHours =
      expiryChoice === "none" ? null : expiryChoice === "custom" ? Number(customHours) : Number(expiryChoice);

    if (expiresInHours === null && !useViewLimit) {
      setError("Set at least one expiry rule: a time limit or a view limit");
      return;
    }

    const form = new FormData();
    form.set("file", file);
    form.set("linkMode", linkMode);
    if (linkMode === "email") {
      for (const email of recipientEmails) form.append("recipientEmails", email);
    }
    if (expiresInHours) form.set("expiresInHours", String(expiresInHours));
    if (useViewLimit) form.set("maxViews", maxViews);
    form.set("requireDecision", String(requireDecision));

    setLoading(true);
    const res = await fetch("/api/shares", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }

    setShareUrl(`${window.location.origin}/s/${data.share.token}`);
  }

  if (shareUrl) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50">
        <AppNav />
        <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center">
            <h1 className="text-xl font-semibold text-zinc-900">Your link is ready</h1>
            <p className="mt-1 text-sm text-zinc-500">Share it however you like. It self-destructs on schedule.</p>
            <div className="mt-6 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <code className="flex-1 truncate text-sm text-zinc-700">{shareUrl}</code>
              <button
                onClick={() => navigator.clipboard.writeText(shareUrl)}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                Copy
              </button>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              >
                Go to dashboard
              </button>
              <button
                onClick={() => setShareUrl(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Share another file
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <AppNav />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900">New share</h1>
        <p className="mt-1 text-sm text-zinc-500">Upload a PNG, JPEG, WEBP, or PDF (max 25MB).</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700">File</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700">Expires after</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXPIRY_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.hours}
                  onClick={() => setExpiryChoice(String(preset.hours))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    expiryChoice === String(preset.hours)
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setExpiryChoice("custom")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  expiryChoice === "custom"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                Custom
              </button>
              <button
                type="button"
                onClick={() => setExpiryChoice("none")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  expiryChoice === "none"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                No time limit
              </button>
            </div>
            {expiryChoice === "custom" && (
              <input
                type="number"
                min={1}
                placeholder="Hours"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                className="mt-2 w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              />
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={useViewLimit}
                onChange={(e) => setUseViewLimit(e.target.checked)}
                className="rounded border-zinc-300"
              />
              Limit number of views
            </label>
            {useViewLimit && (
              <input
                type="number"
                min={1}
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                className="mt-2 w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700">Who can open it</label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setLinkMode("anyone")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  linkMode === "anyone"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                Anyone with the link
              </button>
              <button
                type="button"
                onClick={() => setLinkMode("email")}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  linkMode === "email"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                Specific recipient(s)
              </button>
            </div>
            {linkMode === "email" && (
              <>
                <textarea
                  placeholder={"recipient@example.com\nanother@example.com"}
                  value={recipientEmailsText}
                  onChange={(e) => setRecipientEmailsText(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  One email per line (or comma-separated). Each recipient gets their own code and
                  their own watermark.
                </p>
              </>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={requireDecision}
                onChange={(e) => setRequireDecision(e.target.checked)}
                className="rounded border-zinc-300"
              />
              Ask the recipient to approve or reject
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              Off by default. When on, the viewer sees Approve/Reject buttons and you&apos;ll see
              their decision on the dashboard.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Uploading..." : "Create share link"}
          </button>
        </form>
      </main>
    </div>
  );
}
