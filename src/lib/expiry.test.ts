import { describe, expect, it } from "vitest";
import { isExpired } from "./expiry";

const base = { status: "active" as const, expires_at: null, max_views: null, view_count: 0 };

describe("isExpired", () => {
  it("is not expired when active with no limits and no views yet", () => {
    expect(isExpired(base)).toBe(false);
  });

  it("is expired once status is no longer active", () => {
    expect(isExpired({ ...base, status: "expired" })).toBe(true);
    expect(isExpired({ ...base, status: "deleted" })).toBe(true);
  });

  it("is expired once expires_at is in the past", () => {
    expect(isExpired({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() })).toBe(true);
  });

  it("is not expired while expires_at is still in the future", () => {
    expect(isExpired({ ...base, expires_at: new Date(Date.now() + 60_000).toISOString() })).toBe(false);
  });

  it("is expired once view_count reaches max_views", () => {
    expect(isExpired({ ...base, max_views: 1, view_count: 1 })).toBe(true);
    expect(isExpired({ ...base, max_views: 3, view_count: 3 })).toBe(true);
  });

  it("is not expired while view_count is still under max_views", () => {
    expect(isExpired({ ...base, max_views: 3, view_count: 2 })).toBe(false);
  });
});
