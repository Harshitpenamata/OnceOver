import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOriginal, deleteOriginal } from "@/lib/r2";
import { watermarkImage, watermarkPdf, buildWatermarkLabel } from "@/lib/watermark";
import { sendViewNotification } from "@/lib/email";
import { isExpired } from "@/lib/expiry";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Metadata for the gate page (identity prompt / expired state) - no file bytes yet.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, `view-meta:${getClientIp(request)}`, 60, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { data: share } = await admin.from("shares").select("*").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const expired = isExpired(share);
  if (expired && share.status === "active") {
    await handleExpiry(admin, share);
  }

  return NextResponse.json({
    id: share.id,
    filename: share.original_filename,
    fileType: share.file_type,
    linkMode: share.link_mode,
    decision: share.decision,
    requireDecision: share.require_decision,
    expired,
    viewCount: share.view_count,
    maxViews: share.max_views,
    expiresAt: share.expires_at,
  });
}

// Records the view, burns the watermark in, and streams the file back.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { viewerIdentity, code } = await request.json();
  const admin = createAdminClient();
  const clientIp = getClientIp(request);

  if (!(await checkRateLimit(admin, `view:${clientIp}`, 20, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { data: share } = await admin.from("shares").select("*").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let identity: string;
  if (share.link_mode === "email") {
    // The emailed one-time code is the actual proof of identity here - once
    // it's verified, the watermark uses the share's own recipient_email
    // rather than trusting whatever the client sent as viewerIdentity.
    const { data: codeValid, error: otpError } =
      typeof code === "string"
        ? await admin.rpc("verify_share_otp", { p_share_id: share.id, p_code: code })
        : { data: false, error: null };
    if (otpError || !codeValid) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 403 });
    }
    identity = share.recipient_email!;
  } else {
    identity = (viewerIdentity as string | undefined)?.trim() || "Anonymous";
  }

  // record_view locks the share row and enforces the time/view-count limits
  // atomically, so two near-simultaneous opens of a "1 view only" link can't
  // both slip through a plain read-then-write increment in application code.
  const { data: recorded, error: recordError } = await admin
    .rpc("record_view", { p_share_id: share.id })
    .single<{ accepted: boolean; view_count: number; newly_expired: boolean }>();
  if (recordError) return NextResponse.json({ error: recordError.message }, { status: 500 });

  if (!recorded.accepted) {
    // Rejected before ever reading the file - safe to delete right away if
    // this call is the one discovering the expiry (e.g. a time-based expiry
    // nobody had hit yet).
    if (recorded.newly_expired) {
      await deleteOriginal(share.storage_key).catch(() => {});
    }
    return NextResponse.json({ error: "This file has expired" }, { status: 410 });
  }

  const viewedAt = new Date();

  await admin.from("share_views").insert({
    share_id: share.id,
    viewer_identity: identity,
    viewer_ip: clientIp === "unknown" ? null : clientIp,
    user_agent: request.headers.get("user-agent"),
    viewed_at: viewedAt.toISOString(),
  });

  const original = await getOriginal(share.storage_key);
  const label = buildWatermarkLabel(identity, viewedAt);
  const watermarked =
    share.file_type === "image" ? await watermarkImage(original, label) : await watermarkPdf(original, label);

  // Only safe to delete now that the original has actually been read: when
  // this view was itself the one that hit the view-count limit, it's still
  // owed the file - deleting before getOriginal() above would 404 the very
  // viewer who was supposed to receive it.
  if (recorded.newly_expired) {
    await deleteOriginal(share.storage_key).catch(() => {});
  }

  const { data: owner } = await admin.auth.admin.getUserById(share.owner_id);
  if (owner?.user?.email) {
    await sendViewNotification({
      to: owner.user.email,
      filename: share.original_filename,
      viewerIdentity: identity,
      viewedAt,
      viewCount: recorded.view_count,
      maxViews: share.max_views,
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    }).catch(() => {});
  }

  return new NextResponse(new Uint8Array(watermarked), {
    headers: {
      "Content-Type": share.file_type === "image" ? "image/jpeg" : "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function handleExpiry(
  admin: ReturnType<typeof createAdminClient>,
  share: { id: string; storage_key: string }
) {
  await deleteOriginal(share.storage_key).catch(() => {});
  await admin
    .from("shares")
    .update({ status: "expired", deleted_at: new Date().toISOString() })
    .eq("id", share.id);
}
