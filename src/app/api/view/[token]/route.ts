import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOriginal, deleteOriginal } from "@/lib/r2";
import { watermarkImage, watermarkPdf, buildWatermarkLabel } from "@/lib/watermark";
import { sendViewNotification } from "@/lib/email";
import { isExpired } from "@/lib/expiry";

// Metadata for the gate page (identity prompt / expired state) - no file bytes yet.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

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
    expired,
    viewCount: share.view_count,
    maxViews: share.max_views,
    expiresAt: share.expires_at,
  });
}

// Records the view, burns the watermark in, and streams the file back.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { viewerIdentity } = await request.json();
  const admin = createAdminClient();

  const { data: share } = await admin.from("shares").select("*").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (isExpired(share)) {
    if (share.status === "active") await handleExpiry(admin, share);
    return NextResponse.json({ error: "This file has expired" }, { status: 410 });
  }

  const identity = (viewerIdentity as string | undefined)?.trim() || "Anonymous";
  if (share.link_mode === "email" && identity.toLowerCase() !== share.recipient_email?.toLowerCase()) {
    return NextResponse.json({ error: "This link is restricted to a specific recipient" }, { status: 403 });
  }

  const viewedAt = new Date();
  const forwardedFor = request.headers.get("x-forwarded-for");

  await admin.from("share_views").insert({
    share_id: share.id,
    viewer_identity: identity,
    viewer_ip: forwardedFor?.split(",")[0]?.trim() ?? null,
    user_agent: request.headers.get("user-agent"),
    viewed_at: viewedAt.toISOString(),
  });

  const newViewCount = share.view_count + 1;
  const nowExpired = share.max_views !== null && newViewCount >= share.max_views;

  await admin
    .from("shares")
    .update({ view_count: newViewCount, status: nowExpired ? "expired" : share.status })
    .eq("id", share.id);

  const original = await getOriginal(share.storage_key);
  const label = buildWatermarkLabel(identity, viewedAt);
  const watermarked =
    share.file_type === "image" ? await watermarkImage(original, label) : await watermarkPdf(original, label);

  const { data: owner } = await admin.auth.admin.getUserById(share.owner_id);
  if (owner?.user?.email) {
    await sendViewNotification({
      to: owner.user.email,
      filename: share.original_filename,
      viewerIdentity: identity,
      viewedAt,
      viewCount: newViewCount,
      maxViews: share.max_views,
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    }).catch(() => {});
  }

  if (nowExpired) {
    await deleteOriginal(share.storage_key).catch(() => {});
    await admin
      .from("shares")
      .update({ status: "deleted", deleted_at: new Date().toISOString() })
      .eq("id", share.id);
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
