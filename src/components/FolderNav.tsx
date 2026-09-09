"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Folder } from "@/lib/types";

export function FolderNav({ folders, activeFolder }: { folders: Folder[]; activeFolder?: string }) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const activeFolderObj = folders.find((f) => f.id === activeFolder);

  function pillClass(isActive: boolean) {
    return `rounded-full border px-3 py-1.5 text-xs font-medium ${
      isActive ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
    }`;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim() }),
    });
    if (res.ok) {
      setNewFolderName("");
      setShowCreate(false);
      router.refresh();
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameValue.trim() || !activeFolderObj) return;
    const res = await fetch(`/api/folders/${activeFolderObj.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (res.ok) {
      setRenaming(false);
      router.refresh();
    }
  }

  async function handleDelete() {
    if (!activeFolderObj) return;
    const res = await fetch(`/api/folders/${activeFolderObj.id}`, { method: "DELETE" });
    if (res.ok) router.push("/dashboard");
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard" className={pillClass(!activeFolder)}>
          All files
        </Link>
        <Link href="/dashboard?folder=unfiled" className={pillClass(activeFolder === "unfiled")}>
          Unfiled
        </Link>
        {folders.map((folder) => (
          <Link key={folder.id} href={`/dashboard?folder=${folder.id}`} className={pillClass(activeFolder === folder.id)}>
            {folder.name}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-full border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50"
        >
          + New folder
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mt-2 flex gap-2">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="w-48 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">
            Create
          </button>
        </form>
      )}

      {activeFolderObj && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          {renaming ? (
            <form onSubmit={handleRename} className="flex gap-2">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-48 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-900"
              />
              <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">
                Save
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setRenameValue(activeFolderObj.name);
                  setRenaming(true);
                }}
                className="text-zinc-500 underline hover:text-zinc-900"
              >
                Rename &quot;{activeFolderObj.name}&quot;
              </button>
              <button type="button" onClick={handleDelete} className="text-red-600 underline hover:text-red-800">
                Delete folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
