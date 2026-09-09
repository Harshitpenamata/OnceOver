import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteOriginal } from "@/lib/r2";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: share, error } = await supabase
    .from("shares")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (error || !share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: views } = await supabase
    .from("share_views")
    .select("*")
    .eq("share_id", id)
    .order("viewed_at", { ascending: false });

  const { data: comments } = await supabase
    .from("share_comments")
    .select("*")
    .eq("share_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ share, views: views ?? [], comments: comments ?? [] });
}

// Moves a file into a folder (or back to "Unfiled" if folder_id is null).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { folder_id: folderId } = await request.json();
  if (folderId !== null && typeof folderId !== "string") {
    return NextResponse.json({ error: "folder_id must be a string or null" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shares")
    .update({ folder_id: folderId })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ share: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: share } = await supabase
    .from("shares")
    .select("storage_key")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteOriginal(share.storage_key).catch(() => {});

  const { error } = await supabase
    .from("shares")
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
