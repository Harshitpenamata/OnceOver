import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteOriginal } from "@/lib/r2";

// Triggered by Vercel Cron (see vercel.json). Sweeps shares whose time or
// view-count limit has passed and permanently deletes the underlying file.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: expired, error } = await admin
    .from("shares")
    .select("id, storage_key, max_views, view_count")
    .eq("status", "active")
    .lte("expires_at", nowIso);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: overViewed } = await admin
    .from("shares")
    .select("id, storage_key, max_views, view_count")
    .eq("status", "active")
    .not("max_views", "is", null);

  const toDelete = [
    ...(expired ?? []),
    ...(overViewed ?? []).filter((s) => s.max_views !== null && s.view_count >= s.max_views),
  ];

  const seen = new Set<string>();
  let deletedCount = 0;

  for (const share of toDelete) {
    if (seen.has(share.id)) continue;
    seen.add(share.id);

    await deleteOriginal(share.storage_key).catch(() => {});
    await admin
      .from("shares")
      .update({ status: "expired", deleted_at: new Date().toISOString() })
      .eq("id", share.id);
    deletedCount++;
  }

  return NextResponse.json({ swept: deletedCount });
}
