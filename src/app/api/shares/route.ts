import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadOriginal } from "@/lib/r2";

const ALLOWED_TYPES: Record<string, "image" | "pdf"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
};

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("shares")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shares: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const linkMode = String(form.get("linkMode") ?? "anyone");
  const recipientEmail = form.get("recipientEmail")
    ? String(form.get("recipientEmail"))
    : null;
  const expiresInHours = form.get("expiresInHours")
    ? Number(form.get("expiresInHours"))
    : null;
  const maxViews = form.get("maxViews") ? Number(form.get("maxViews")) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const fileType = ALLOWED_TYPES[file.type];
  if (!fileType) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, WEBP, and PDF files are supported" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25MB limit" }, { status: 400 });
  }
  if (linkMode === "email" && !recipientEmail) {
    return NextResponse.json(
      { error: "recipientEmail is required when linkMode is 'email'" },
      { status: 400 }
    );
  }
  if (!expiresInHours && !maxViews) {
    return NextResponse.json(
      { error: "Set at least one expiry rule: a time limit or a view limit" },
      { status: 400 }
    );
  }

  const token = nanoid(24);
  const storageKey = `originals/${user.id}/${token}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadOriginal(storageKey, buffer, file.type);

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("shares")
    .insert({
      owner_id: user.id,
      token,
      original_filename: file.name,
      mime_type: file.type,
      file_type: fileType,
      storage_key: storageKey,
      file_size_bytes: file.size,
      link_mode: linkMode,
      recipient_email: recipientEmail,
      expires_at: expiresAt,
      max_views: maxViews,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ share: data }, { status: 201 });
}
