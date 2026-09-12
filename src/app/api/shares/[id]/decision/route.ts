import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyViewerProof } from "@/lib/viewer-verification";

// Recipients aren't authenticated Supabase users, so decisions are recorded
// via the admin client after validating the share token supplied by the client.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, `decision:${getClientIp(request)}`, 10, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { token, decision } = await request.json();

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  const { data: share } = await admin
    .from("shares")
    .select("id, token, require_decision, link_mode")
    .eq("id", id)
    .single();

  if (!share || share.token !== token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!share.require_decision) {
    return NextResponse.json({ error: "This share doesn't request a decision" }, { status: 400 });
  }
  // The token alone is the intended proof for "anyone" links, but an
  // email-locked share's decision is meant to be attributable to the
  // verified recipient, not just whoever holds the link.
  if (share.link_mode === "email" && !verifyViewerProof(request.headers.get("x-viewer-proof"), share.id)) {
    return NextResponse.json({ error: "Verification required" }, { status: 403 });
  }

  const { error } = await admin.from("shares").update({ decision }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
