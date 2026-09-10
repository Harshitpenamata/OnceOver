import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendCommentNotification } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

// Sender (authenticated owner) posts a reply in the thread.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await checkRateLimit(supabase, `sender-comment:${user.id}`, 30, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { body } = await request.json();
  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }

  const { data: share } = await supabase
    .from("shares")
    .select("id, original_filename")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The "owners insert comments as sender" RLS policy allows this insert
  // directly through the authenticated client - no need for the service-role
  // admin client here (that's reserved for the unauthenticated recipient
  // side, in api/view/[token]/comments, where there's no Supabase user).
  const { data: comment, error } = await supabase
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

  const { data: recipients } = await supabase.from("share_recipients").select("email").eq("share_id", id);
  await Promise.all(
    (recipients ?? []).map((r) =>
      sendCommentNotification({
        to: r.email,
        filename: share.original_filename,
        authorName: user.email ?? "Sender",
        body: body.trim(),
        dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      }).catch(() => {})
    )
  );

  return NextResponse.json({ comment }, { status: 201 });
}
