import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/email";

// Adds a recipient to an already-active email-locked share.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: share } = await supabase
    .from("shares")
    .select("id, link_mode")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (share.link_mode !== "email") {
    return NextResponse.json(
      { error: "This share isn't restricted to specific recipients" },
      { status: 400 }
    );
  }

  const { email } = await request.json();
  const trimmed = typeof email === "string" ? email.trim() : "";
  if (!trimmed || !isValidEmail(trimmed)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("share_recipients")
    .insert({ share_id: id, email: trimmed })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That email already has access" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ recipient: data }, { status: 201 });
}
