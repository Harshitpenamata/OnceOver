"use client";

import { useRouter } from "next/navigation";
import type { Folder } from "@/lib/types";

export function FolderSelect({
  shareId,
  currentFolderId,
  folders,
}: {
  shareId: string;
  currentFolderId: string | null;
  folders: Folder[];
}) {
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const folderId = e.target.value || null;
    const res = await fetch(`/api/shares/${shareId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: folderId }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <select
      value={currentFolderId ?? ""}
      onChange={handleChange}
      className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 outline-none focus:border-zinc-900"
    >
      <option value="">Unfiled</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {folder.name}
        </option>
      ))}
    </select>
  );
}
