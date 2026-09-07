import type { Share } from "@/lib/types";

export function isExpired(share: Pick<Share, "status" | "expires_at" | "max_views" | "view_count">): boolean {
  if (share.status !== "active") return true;
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return true;
  if (share.max_views !== null && share.view_count >= share.max_views) return true;
  return false;
}

export const EXPIRY_PRESETS = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "24 hours", hours: 24 },
] as const;
