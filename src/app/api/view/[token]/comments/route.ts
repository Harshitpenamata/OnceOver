import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCommentNotification } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyViewerProof } from "@/lib/viewer-verification";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: share } = await admin.from("shares").select("id, link_mode").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Email-locked shares gate the file behind OTP - comments must match that,
  // or anyone who obtained the link without being the invited recipient
  // could read (and, in POST below, post as) the recipient's thread.
  if (share.link_mode === "email" && !verifyViewerProof(request.headers.get("x-viewer-proof"), share.id)) {
    return NextResponse.json({ error: "Verification required" }, { status: 403 });
  }

  const { data: comments } = await admin
    .from("share_comments")
    .select("*")
    .eq("share_id", share.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ comments: comments ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, `comment:${getClientIp(request)}`, 10, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { authorName, body } = await request.json();

  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }

  const { data: share } = await admin
    .from("shares")
    .select("id, owner_id, original_filename, link_mode")
    .eq("token", token)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (share.link_mode === "email" && !verifyViewerProof(request.headers.get("x-viewer-proof"), share.id)) {
    return NextResponse.json({ error: "Verification required" }, { status: 403 });
  }

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
