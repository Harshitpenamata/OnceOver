import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { generateOtpCode } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";
import { isExpired } from "@/lib/expiry";

// Sends a one-time code to the recipient's inbox before an email-locked
// share can be opened - proves the viewer controls that inbox, not just
// that they know or guessed the address (a bare string match can't tell
// those apart).
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, `otp-request:${getClientIp(request)}`, 10, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { email } = await request.json();
  const { data: share } = await admin.from("shares").select("*").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (share.link_mode !== "email") {
    return NextResponse.json({ error: "This link doesn't require a code" }, { status: 400 });
  }
  if (isExpired(share)) {
    return NextResponse.json({ error: "This file has expired" }, { status: 410 });
  }
  if (typeof email !== "string" || email.trim().toLowerCase() !== share.recipient_email?.toLowerCase()) {
    return NextResponse.json({ error: "This link is restricted to a specific recipient" }, { status: 403 });
  }

  // Limit how often a code can be requested for THIS share regardless of
  // caller IP, so an attacker can't spam the recipient's inbox from many IPs.
  if (!(await checkRateLimit(admin, `otp-share:${share.id}`, 3, 10 * 60))) {
    return NextResponse.json({ error: "Too many codes requested - try again in a few minutes" }, { status: 429 });
  }

  const code = generateOtpCode();
  await admin.from("share_otps").insert({
    share_id: share.id,
    code,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  await sendOtpEmail({ to: share.recipient_email, filename: share.original_filename, code }).catch(() => {});

  return NextResponse.json({ ok: true });
}
