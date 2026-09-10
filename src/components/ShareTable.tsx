"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { FolderSelect } from "@/components/FolderSelect";
import type { Folder, Share } from "@/lib/types";

export function ShareTable({
  shares,
  folders,
  viewersByShare,
  commentsByShare,
}: {
  shares: Share[];
  folders: Folder[];
  viewersByShare: Record<string, string[]>;
  commentsByShare: Record<string, { author_name: string; body: string }[]>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const allSelected = shares.length > 0 && selected.size === shares.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(shares.map((s) => s.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteShares(ids: string[]) {
    setBusy(true);
    await Promise.all(ids.map((id) => fetch(`/api/shares/${id}`, { method: "DELETE" })));
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  function handleDeleteOne(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"? This permanently removes the file.`)) return;
    deleteShares([id]);
  }

  function handleDeleteSelected() {
    if (!confirm(`Delete ${selected.size} selected file(s)? This permanently removes them.`)) return;
    deleteShares([...selected]);
  }

  function startRename(share: Share) {
    setRenamingId(share.id);
    setRenameValue(share.original_filename);
  }

  async function submitRename(id: string) {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/shares/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ original_filename: renameValue.trim() }),
    });
    setBusy(false);
    setRenamingId(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="mt-6">
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
          <span className="text-zinc-600">{selected.size} selected</span>
          <button
            onClick={handleDeleteSelected}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Delete selected
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="w-8 px-4 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-zinc-300" />
              </th>
              <th className="px-4 py-3 font-medium">File</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Decision</th>
              <th className="px-4 py-3 font-medium">Views</th>
              <th className="px-4 py-3 font-medium">Viewed by</th>
              <th className="px-4 py-3 font-medium">Comments</th>
              <th className="px-4 py-3 font-medium">Folder</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((share) => (
              <tr key={share.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(share.id)}
                    onChange={() => toggleOne(share.id)}
                    className="rounded border-zinc-300"
                  />
                </td>
                <td className="px-4 py-3">
                  {renamingId === share.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitRename(share.id);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(share.id)}
                        className="w-40 rounded-lg border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-900"
                      />
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/share/${share.id}`} className="font-medium text-zinc-900 hover:underline">
                        {share.original_filename}
                      </Link>
                      <button
                        onClick={() => startRename(share)}
                        className="text-xs text-zinc-400 underline hover:text-zinc-700"
                      >
                        Rename
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge label={share.status} />
                </td>
                <td className="px-4 py-3">
                  {share.require_decision ? (
                    <StatusBadge label={share.decision} />
                  ) : (
                    <span className="text-zinc-400">Not requested</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {share.view_count}
                  {share.max_views ? ` / ${share.max_views}` : ""}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {(viewersByShare[share.id] ?? []).length === 0 ? (
                    <span className="text-zinc-400">Nobody yet</span>
                  ) : (
                    viewersByShare[share.id].join(", ")
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {(() => {
                    const shareComments = commentsByShare[share.id] ?? [];
                    if (shareComments.length === 0) {
                      return <span className="text-zinc-400">None</span>;
                    }
                    const latest = shareComments[shareComments.length - 1];
                    return (
                      <Link href={`/dashboard/share/${share.id}`} className="hover:underline">
                        <div>{shareComments.length}</div>
                        <div className="max-w-[220px] truncate text-xs text-zinc-400">
                          {latest.author_name}: {latest.body}
                        </div>
                      </Link>
                    );
                  })()}
                </td>
                <td className="px-4 py-3">
                  <FolderSelect shareId={share.id} currentFolderId={share.folder_id} folders={folders} />
                </td>
                <td className="px-4 py-3 text-zinc-500">{new Date(share.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDeleteOne(share.id, share.original_filename)}
                    disabled={busy}
                    className="text-xs text-red-600 underline hover:text-red-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
