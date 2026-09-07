import type { SupabaseClient } from "@supabase/supabase-js";

// check_rate_limit is a Postgres function (see supabase/schema.sql) so the
// counter is atomic and shared across serverless invocations, unlike an
// in-memory counter which wouldn't persist reliably on Vercel.
export async function checkRateLimit(
  client: SupabaseClient,
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await client.rpc("check_rate_limit", {
    p_key: key,
    p_max_attempts: maxAttempts,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate limit check failed, failing open:", error.message);
    return true;
  }
  return data === true;
}

export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
