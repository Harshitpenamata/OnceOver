import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCommentNotification } from "@/lib/email";

// Sender (authenticated owner) posts a reply in the thread.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body } = await request.json();
  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }

  const { data: share } = await supabase
    .from("shares")
    .select("id, original_filename, recipient_email")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Sender writes go through the admin client too, so the same insert path
  // (and notification logic) is shared with the recipient-side route.
  const admin = createAdminClient();
  const { data: comment, error } = await admin
    .from("share_comments")
    .insert({
      share_id: id,
      author_type: "sender",
      author_name: user.email ?? "Sender",
      body: body.trim(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (share.recipient_email) {
    await sendCommentNotification({
      to: share.recipient_email,
      filename: share.original_filename,
      authorName: user.email ?? "Sender",
      body: body.trim(),
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    }).catch(() => {});
  }

  return NextResponse.json({ comment }, { status: 201 });
}
