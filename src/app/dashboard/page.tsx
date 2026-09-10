import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import { FolderNav } from "@/components/FolderNav";
import { ShareTable } from "@/components/ShareTable";

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

  let sharesQuery = supabase
    .from("shares")
    .select("*")
    .neq("status", "deleted")
    .order("created_at", { ascending: false });
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

  const viewersByShare: Record<string, string[]> = {};
  for (const v of views ?? []) {
    (viewersByShare[v.share_id] ??= []).push(v.viewer_identity);
  }

  const { data: comments } = shareIds.length
    ? await supabase
        .from("share_comments")
        .select("share_id, author_name, body, created_at")
        .in("share_id", shareIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const commentsByShare: Record<string, { author_name: string; body: string }[]> = {};
  for (const c of comments ?? []) {
    (commentsByShare[c.share_id] ??= []).push({ author_name: c.author_name, body: c.body });
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
          <ShareTable
            shares={shares}
            folders={folders ?? []}
            viewersByShare={viewersByShare}
            commentsByShare={commentsByShare}
          />
        )}
      </main>
    </div>
  );
}
