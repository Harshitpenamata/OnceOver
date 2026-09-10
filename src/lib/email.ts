import { Resend, type CreateEmailOptions } from "resend";

const FROM = process.env.RESEND_FROM_EMAIL ?? "OnceOver <notifications@onceover.app>";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

// Lazily constructed so builds and routes that never send email don't require
// RESEND_API_KEY to be set (the Resend constructor throws without one).
function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

// Resend's SDK never rejects/throws - every failure (a rejected send, a
// network error, anything) resolves as { data: null, error }. Every
// `.catch()` at every call site of these functions was therefore dead code:
// none of them could ever have observed a send failure. This turns a real
// failure into a real rejection so those `.catch()`s (and the OTP retry
// below) actually do something.
async function send(payload: CreateEmailOptions): Promise<void> {
  const { error } = await getResendClient().emails.send(payload);
  if (error) {
    throw new Error(`Resend error (${error.name ?? "unknown"}): ${error.message ?? JSON.stringify(error)}`);
  }
}

export async function sendViewNotification(opts: {
  to: string;
  filename: string;
  viewerIdentity: string;
  viewedAt: Date;
  viewCount: number;
  maxViews: number | null;
  dashboardUrl: string;
}) {
  const { to, filename, viewerIdentity, viewedAt, viewCount, maxViews, dashboardUrl } = opts;
  const remaining = maxViews ? Math.max(0, maxViews - viewCount) : null;

  await send({
    from: FROM,
    to,
    subject: `${filename} was just opened`,
    html: `
      <p><strong>${escapeHtml(viewerIdentity)}</strong> opened <strong>${escapeHtml(
      filename
    )}</strong> at ${viewedAt.toISOString()}.</p>
      ${
        remaining !== null
          ? `<p>${remaining} view${remaining === 1 ? "" : "s"} remaining before it expires.</p>`
          : ""
      }
      <p><a href="${dashboardUrl}">View activity and reply in the comment thread</a></p>
    `,
  });
}

export async function sendOtpEmail(opts: { to: string; filename: string; code: string }) {
  const { to, filename, code } = opts;
  const payload: CreateEmailOptions = {
    from: FROM,
    to,
    subject: `Your code to view ${filename}`,
    html: `
      <p>Use this code to confirm it's you before viewing <strong>${escapeHtml(filename)}</strong>:</p>
      <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px;">${escapeHtml(code)}</p>
      <p>This code expires in 10 minutes and can only be used once.</p>
    `,
  };

  // This is the one send on a user-blocking path - the recipient is looking
  // at a "check your inbox" screen waiting on it - so it gets one immediate
  // retry instead of surfacing the first failure straight away. A transient
  // hiccup on the very first attempt is the most common real-world failure
  // mode here.
  try {
    await send(payload);
  } catch {
    await send(payload);
  }
}

export async function sendCommentNotification(opts: {
  to: string;
  filename: string;
  authorName: string;
  body: string;
  dashboardUrl: string;
}) {
  const { to, filename, authorName, body, dashboardUrl } = opts;

  await send({
    from: FROM,
    to,
    subject: `New comment on ${filename}`,
    html: `
      <p><strong>${escapeHtml(authorName)}</strong> commented on <strong>${escapeHtml(
      filename
    )}</strong>:</p>
      <blockquote>${escapeHtml(body)}</blockquote>
      <p><a href="${dashboardUrl}">Reply</a></p>
    `,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
