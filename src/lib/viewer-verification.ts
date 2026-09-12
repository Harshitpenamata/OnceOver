import { createHmac, timingSafeEqual } from "crypto";

// Proves a viewer already completed OTP verification for an email-locked
// share, so endpoints that run after the file is opened (comments, decision)
// don't need to re-verify against share_otps - that code is single-use and
// gets consumed the first time (see verify_share_otp in schema.sql), so a
// second verification with the same code would always fail.
//
// Signed with the service-role key (already server-only and secret) rather
// than a dedicated env var, since only server code ever needs to mint or
// check one of these.
const TTL_MS = 60 * 60 * 1000; // covers a full viewing session

function sign(payload: string): string {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(payload).digest("base64url");
}

export function issueViewerProof(shareId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ shareId, email, exp: Date.now() + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Returns the verified recipient email on success, or null if the proof is
// missing, malformed, expired, tampered with, or for a different share.
export function verifyViewerProof(proof: string | null, shareId: string): string | null {
  if (!proof) return null;
  const [payload, signature] = proof.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { shareId: proofShareId, email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (proofShareId !== shareId || typeof email !== "string" || typeof exp !== "number" || exp < Date.now()) {
      return null;
    }
    return email;
  } catch {
    return null;
  }
}
