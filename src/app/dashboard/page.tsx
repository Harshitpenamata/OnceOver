import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import { StatusBadge } from "@/components/StatusBadge";
import { FolderNav } from "@/components/FolderNav";
import { FolderSelect } from "@/components/FolderSelect";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder: activeFolder } = await searchParams;
  const supabase = await createClient();

  const { data: folders } = await supabase
    .from("folders")
    .select("*")
    .order("created_at", { ascending: true });

  let sharesQuery = supabase.from("shares").select("*").order("created_at", { ascending: false });
  if (activeFolder === "unfiled") {
    sharesQuery = sharesQuery.is("folder_id", null);
  } else if (activeFolder) {
    sharesQuery = sharesQuery.eq("folder_id", activeFolder);
  }
  const { data: shares } = await sharesQuery;

  const shareIds = shares?.map((s) => s.id) ?? [];
  const { data: views } = shareIds.length
    ? await supabase
        .from("share_views")
        .select("share_id, viewer_identity")
        .in("share_id", shareIds)
        .order("viewed_at", { ascending: true })
    : { data: [] };

  const viewersByShare = new Map<string, string[]>();
  for (const v of views ?? []) {
    const list = viewersByShare.get(v.share_id) ?? [];
    list.push(v.viewer_identity);
    viewersByShare.set(v.share_id, list);
  }

  const { data: comments } = shareIds.length
    ? await supabase
        .from("share_comments")
        .select("share_id, author_name, body, created_at")
        .in("share_id", shareIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const commentsByShare = new Map<string, { author_name: string; body: string }[]>();
  for (const c of comments ?? []) {
    const list = commentsByShare.get(c.share_id) ?? [];
    list.push({ author_name: c.author_name, body: c.body });
    commentsByShare.set(c.share_id, list);
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <AppNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900">Your shares</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every file you&apos;ve sent, its expiry status, and who&apos;s opened it.
        </p>

        <FolderNav folders={folders ?? []} activeFolder={activeFolder} />

        {!shares?.length ? (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <p className="text-zinc-500">
              {activeFolder ? "No files in this folder." : "You haven't shared anything yet."}
            </p>
            <Link
              href="/upload"
              className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Share your first file
            </Link>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3 font-medium">Views</th>
                  <th className="px-4 py-3 font-medium">Viewed by</th>
                  <th className="px-4 py-3 font-medium">Comments</th>
                  <th className="px-4 py-3 font-medium">Folder</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/share/${share.id}`} className="font-medium text-zinc-900 hover:underline">
                        {share.original_filename}
                      </Link>
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
                      {(viewersByShare.get(share.id) ?? []).length === 0 ? (
                        <span className="text-zinc-400">Nobody yet</span>
                      ) : (
                        viewersByShare.get(share.id)!.join(", ")
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {(() => {
                        const shareComments = commentsByShare.get(share.id) ?? [];
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
                      <FolderSelect shareId={share.id} currentFolderId={share.folder_id} folders={folders ?? []} />
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(share.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
