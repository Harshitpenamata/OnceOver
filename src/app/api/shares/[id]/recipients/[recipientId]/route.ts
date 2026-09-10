import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Removes a recipient's access while a share is still active. Also revokes
// any OTP code already issued to them - without this, someone whose access
// was just pulled could still use a code already sitting in their inbox,
// since verify_share_otp only checks share_otps, not current
// share_recipients membership.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const { id, recipientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: share } = await supabase
    .from("shares")
    .select("id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: recipient } = await supabase
    .from("share_recipients")
    .select("email")
    .eq("id", recipientId)
    .eq("share_id", id)
    .single();
  if (!recipient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase
    .from("share_recipients")
    .delete()
    .eq("id", recipientId)
    .eq("share_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // share_otps has no owner-facing RLS policy (only the security-definer
  // verify function reaches it), so revoking pending codes needs the admin
  // client.
  const admin = createAdminClient();
  await admin
    .from("share_otps")
    .delete()
    .eq("share_id", id)
    .ilike("recipient_email", recipient.email);

  return NextResponse.json({ ok: true });
}
