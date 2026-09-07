import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCommentNotification } from "@/lib/email";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: share } = await admin.from("shares").select("id").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: comments } = await admin
    .from("share_comments")
    .select("*")
    .eq("share_id", share.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ comments: comments ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { authorName, body } = await request.json();

  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: share } = await admin
    .from("shares")
    .select("id, owner_id, original_filename")
    .eq("token", token)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: comment, error } = await admin
    .from("share_comments")
    .insert({
      share_id: share.id,
      author_type: "recipient",
      author_name: (authorName as string | undefined)?.trim() || "Recipient",
      body: body.trim(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: owner } = await admin.auth.admin.getUserById(share.owner_id);
  if (owner?.user?.email) {
    await sendCommentNotification({
      to: owner.user.email,
      filename: share.original_filename,
      authorName: comment.author_name,
      body: comment.body,
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    }).catch(() => {});
  }

  return NextResponse.json({ comment }, { status: 201 });
}
