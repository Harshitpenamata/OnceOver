import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Recipients aren't authenticated Supabase users, so decisions are recorded
// via the admin client after validating the share token supplied by the client.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token, decision } = await request.json();

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: share } = await admin
    .from("shares")
    .select("id, token")
    .eq("id", id)
    .single();

  if (!share || share.token !== token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.from("shares").update({ decision }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
