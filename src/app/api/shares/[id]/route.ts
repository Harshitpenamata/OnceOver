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

// Moves a file into a folder (folder_id) and/or renames it
// (original_filename). Either field is optional; only the fields present in
// the body are updated.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const updates: { folder_id?: string | null; original_filename?: string } = {};

  if ("folder_id" in body) {
    const folderId = body.folder_id;
    if (folderId !== null && typeof folderId !== "string") {
      return NextResponse.json({ error: "folder_id must be a string or null" }, { status: 400 });
    }
    updates.folder_id = folderId;
  }

  if ("original_filename" in body) {
    const name = body.original_filename;
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "original_filename must be a non-empty string" }, { status: 400 });
    }
    updates.original_filename = name.trim();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shares")
    .update(updates)
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
