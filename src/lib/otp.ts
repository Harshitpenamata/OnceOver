import { randomInt } from "crypto";

// Zero-padded 6-digit code, e.g. "042817". Uses crypto.randomInt (not
// Math.random) since this gates access to a real file.
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
