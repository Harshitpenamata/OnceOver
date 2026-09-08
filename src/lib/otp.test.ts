import { describe, expect, it } from "vitest";
import { generateOtpCode } from "./otp";

describe("generateOtpCode", () => {
  it("returns a zero-padded 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("produces varied codes, not a fixed value", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
