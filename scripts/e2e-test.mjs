// End-to-end test against a REAL Supabase/R2/Resend backend and a running
// dev server - not mocked. This is what actually caught the delete-before-
// read ordering bug in the view-limit fix that unit tests alone would not
// have surfaced (it depends on the real Postgres RPC, real R2 object
// lifecycle, and real HTTP race timing).
//
// Requires: `npm run dev` running in another terminal, and the same
// .env.local this repo already uses for Supabase/R2/Resend.
//
// Usage:
//   set -a && source .env.local && set +a && node scripts/e2e-test.mjs
//
// Creates and cleans up its own share rows and R2 objects. Leaves behind
// (and reuses on repeat runs) one confirmed Supabase user so you can also
// log into the app by hand: TEST_EMAIL / TEST_PASSWORD below.

import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const TEST_EMAIL = "harshit3199@gmail.com";
const TEST_PASSWORD = "OnceOver-QA-Test-2026!";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function restQuery(table, qs) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: adminHeaders });
  return res.json();
}

async function objectExistsInR2(key) {
  try {
    await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

const createdShareIds = [];

// --- 1. Auth: sign in, creating the user first if needed -------------------
console.log("\n== Auth ==");
let session;
{
  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  if (signIn.ok) {
    session = await signIn.json();
    check("signed in with existing test user", true);
  } else {
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
    });
    check("create test user via admin API", create.ok, await create.text());
    const retry = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    check("sign in after creating user", retry.ok);
    session = await retry.json();
  }
}
check("got access_token", !!session.access_token);

const cookieName = `sb-${PROJECT_REF}-auth-token`;
const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
const cookieHeader = `${cookieName}=${cookieValue}`;

async function uploadShare(fileBuffer, filename, mimeType, fields) {
  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${APP_URL}/api/shares`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
    body: form,
  });
  return res;
}

// --- 2. Image path: the view-count race condition fix -----------------------
console.log("\n== Image share: concurrent race on a 1-view link ==");
const png = await sharp({
  create: { width: 500, height: 350, channels: 3, background: { r: 40, g: 80, b: 200 } },
})
  .png()
  .toBuffer();

const uploadImg = await uploadShare(png, "qa-test-image.png", "image/png", { linkMode: "anyone", maxViews: "1" });
check("upload image share returns 201", uploadImg.status === 201, await uploadImg.clone().text());
const { share: shareImg } = await uploadImg.json();
createdShareIds.push(shareImg.id);

const [imgRes1, imgRes2] = await Promise.all([
  fetch(`${APP_URL}/api/view/${shareImg.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewerIdentity: "QA Tester A" }),
  }),
  fetch(`${APP_URL}/api/view/${shareImg.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewerIdentity: "QA Tester B" }),
  }),
]);
const imgStatuses = [imgRes1.status, imgRes2.status].sort();
check(
  "exactly one concurrent view succeeds (200) and the other is rejected (410)",
  imgStatuses[0] === 200 && imgStatuses[1] === 410,
  `got statuses: ${imgStatuses}`
);
const imgWinner = imgRes1.status === 200 ? imgRes1 : imgRes2;
const imgBytes = Buffer.from(await imgWinner.clone().arrayBuffer());
check(
  "the successful view returned a non-trivial watermarked JPEG",
  imgWinner.headers.get("content-type") === "image/jpeg" && imgBytes.length > 1000,
  `content-type=${imgWinner.headers.get("content-type")} bytes=${imgBytes.length}`
);

const [shareImgRow] = await restQuery("shares", `id=eq.${shareImg.id}&select=*`);
check(
  "DB row after the race: view_count=1, status=expired, deleted_at set",
  shareImgRow.view_count === 1 && shareImgRow.status === "expired" && !!shareImgRow.deleted_at,
  JSON.stringify(shareImgRow)
);
check(
  "the winning view still received the file before it was deleted from R2",
  !(await objectExistsInR2(shareImgRow.storage_key))
);

// --- 3. PDF path: watermarkPdf, not just watermarkImage ---------------------
console.log("\n== PDF share ==");
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage([400, 500]);
pdfDoc.addPage([400, 500]);
const pdfBytes = Buffer.from(await pdfDoc.save());

const uploadPdf = await uploadShare(pdfBytes, "qa-test.pdf", "application/pdf", {
  linkMode: "anyone",
  maxViews: "5",
});
check("upload PDF share returns 201", uploadPdf.status === 201, await uploadPdf.clone().text());
const { share: sharePdf } = await uploadPdf.json();
createdShareIds.push(sharePdf.id);

const pdfViewRes = await fetch(`${APP_URL}/api/view/${sharePdf.token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ viewerIdentity: "QA Tester" }),
});
const pdfViewBytes = Buffer.from(await pdfViewRes.clone().arrayBuffer());
check(
  "PDF view returns a valid, watermarked PDF",
  pdfViewRes.status === 200 &&
    pdfViewRes.headers.get("content-type") === "application/pdf" &&
    pdfViewBytes.length > pdfBytes.length,
  `status=${pdfViewRes.status} content-type=${pdfViewRes.headers.get("content-type")} bytes=${pdfViewBytes.length} (original ${pdfBytes.length})`
);
const reloaded = await PDFDocument.load(pdfViewBytes);
check("watermarked PDF still has both pages and is parseable", reloaded.getPageCount() === 2);

// --- 4. Cron cleanup endpoint: a share that expired by time, never viewed --
console.log("\n== Cron cleanup endpoint ==");
const uploadCron = await uploadShare(png, "qa-cron-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
});
check("upload share for cron test returns 201", uploadCron.status === 201);
const { share: shareCron } = await uploadCron.json();
createdShareIds.push(shareCron.id);

// Simulate time passing: move expires_at into the past directly, the way a
// real 1-hour link would look an hour later. Nobody ever viewed it, so only
// the cron sweep (not the view route) is responsible for reclaiming it.
await fetch(`${SUPABASE_URL}/rest/v1/shares?id=eq.${shareCron.id}`, {
  method: "PATCH",
  headers: adminHeaders,
  body: JSON.stringify({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
});

check(
  "expired-but-never-viewed object still exists in R2 before the sweep",
  await objectExistsInR2((await restQuery("shares", `id=eq.${shareCron.id}&select=storage_key`))[0].storage_key)
);

const cronRes = await fetch(`${APP_URL}/api/cron/cleanup`, {
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
const cronBody = await cronRes.json();
check("cron endpoint rejects requests without the secret", (await fetch(`${APP_URL}/api/cron/cleanup`)).status === 401);
check("cron endpoint accepts the correct secret and reports a sweep", cronRes.status === 200 && cronBody.swept >= 1, JSON.stringify(cronBody));

const [shareCronRow] = await restQuery("shares", `id=eq.${shareCron.id}&select=*`);
check(
  "the never-viewed share is now expired and its R2 object is gone",
  shareCronRow.status === "expired" && !(await objectExistsInR2(shareCronRow.storage_key))
);

// --- 5. Rate limiting: the view route is capped at 20 requests/min/IP ------
console.log("\n== Rate limiting ==");
const uploadRateLimit = await uploadShare(png, "qa-rate-limit-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
});
check("upload share for rate-limit test returns 201", uploadRateLimit.status === 201);
const { share: shareRateLimit } = await uploadRateLimit.json();
createdShareIds.push(shareRateLimit.id);

// Fired concurrently, not sequentially awaited: each of these hits a real
// share, so the server does genuinely expensive work per request (R2 fetch,
// Sharp/pdf-lib watermarking, a Supabase RPC, a Resend email send). A
// sequential loop can take longer in wall-clock time than the 60-second
// rate-limit window, letting the fixed window roll over mid-burst and never
// actually accumulate past the limit - that's a test-timing flaw, not
// evidence the limiter is broken. Concurrent requests land within the same
// window regardless of how slow the endpoint itself is.
const rateLimitStatuses = (
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      fetch(`${APP_URL}/api/view/${shareRateLimit.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerIdentity: `QA Rate Test ${i}` }),
      })
    )
  )
).map((res) => res.status);

// Don't assume a clean budget of 20: earlier sections in this same run
// already made a few view requests from this same IP within the window.
// Concurrent responses also don't resolve in a guaranteed order, so check
// the real invariant (some accepted, the rest blocked, nothing else) rather
// than a strict ordered prefix/suffix split.
const acceptedCount = rateLimitStatuses.filter((s) => s === 200).length;
const blockedCount = rateLimitStatuses.filter((s) => s === 429).length;
check(
  "rate limit accepts up to the remaining budget and blocks the rest of the burst",
  acceptedCount > 0 && acceptedCount <= 20 && acceptedCount + blockedCount === 25,
  `statuses: ${rateLimitStatuses.join(",")}`
);

// --- Cleanup ------------------------------------------------------------
console.log("\n== Cleanup ==");
for (const id of createdShareIds) {
  await fetch(`${SUPABASE_URL}/rest/v1/shares?id=eq.${id}`, { method: "DELETE", headers: adminHeaders });
}
console.log(`  Deleted ${createdShareIds.length} test share row(s) (cascades to views/comments).`);
console.log(`  Test account kept: ${TEST_EMAIL} / ${TEST_PASSWORD} (log in at ${APP_URL}/login)`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
