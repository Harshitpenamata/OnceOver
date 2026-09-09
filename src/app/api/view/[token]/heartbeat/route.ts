import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// The viewer page pings this periodically while the tab is visible/focused
// (heartbeat) and once more via sendBeacon on tab close/navigation away.
// Each ping just overwrites duration_seconds with the client's current
// cumulative elapsed time, so a killed session still keeps whatever the
// last successful ping recorded, rather than only ever knowing an "opened"
// timestamp with no idea how long it stayed open.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  if (!(await checkRateLimit(admin, `heartbeat:${getClientIp(request)}`, 30, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { sessionId, elapsedSeconds } = await request.json();
  if (typeof sessionId !== "string" || typeof elapsedSeconds !== "number" || elapsedSeconds < 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: share } = await admin.from("shares").select("id").eq("token", token).single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await admin
    .from("share_views")
    .update({ duration_seconds: Math.round(elapsedSeconds) })
    .eq("id", sessionId)
    .eq("share_id", share.id);

  return NextResponse.json({ ok: true });
}
