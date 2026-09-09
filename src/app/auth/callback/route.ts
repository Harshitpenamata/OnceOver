import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles Supabase's email confirmation / magic-link redirect.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") ?? "/dashboard";
  // Only allow same-app paths - a leading "//" or "/\" is browser-parsed as a
  // protocol-relative URL, so an unvalidated `next` here is an open redirect
  // (e.g. next=".evil.com" turns `${origin}${next}` into a valid, different host).
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.startsWith("/\\")
      ? requestedNext
      : "/dashboard";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
