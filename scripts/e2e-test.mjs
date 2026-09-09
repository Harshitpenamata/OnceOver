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

// --- 5. Email-locked share: OTP proves inbox control, not just a string match --
console.log("\n== Email-locked share (OTP flow) ==");
const uploadLocked = await uploadShare(png, "qa-otp-test.png", "image/png", {
  linkMode: "email",
  recipientEmail: TEST_EMAIL,
  expiresInHours: "1",
});
check("upload email-locked share returns 201", uploadLocked.status === 201);
const { share: shareLocked } = await uploadLocked.json();
createdShareIds.push(shareLocked.id);

const wrongEmailReq = await fetch(`${APP_URL}/api/view/${shareLocked.token}/request-otp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "someone-else@example.com" }),
});
check("requesting a code with the wrong email is rejected (403)", wrongEmailReq.status === 403);

const rightEmailReq = await fetch(`${APP_URL}/api/view/${shareLocked.token}/request-otp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL }),
});
check("requesting a code with the matching email succeeds", rightEmailReq.status === 200);

// Codes are stored in plaintext (short-lived, single-use, rate-limited - see
// schema.sql), so the test can read it directly rather than needing to
// intercept the real email Resend sent.
const [otpRow] = await restQuery(
  "share_otps",
  `share_id=eq.${shareLocked.id}&order=created_at.desc&limit=1&select=code`
);
check("a plaintext code was stored for this share", !!otpRow?.code, JSON.stringify(otpRow));
const realCode = otpRow.code;
const wrongCode = realCode === "000000" ? "111111" : "000000";

const wrongCodeView = await fetch(`${APP_URL}/api/view/${shareLocked.token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: wrongCode }),
});
check("viewing with the wrong code is rejected (403)", wrongCodeView.status === 403);

const rightCodeView = await fetch(`${APP_URL}/api/view/${shareLocked.token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: realCode }),
});
check("viewing with the correct code succeeds (200)", rightCodeView.status === 200);

const [lockedViewRow] = await restQuery("share_views", `share_id=eq.${shareLocked.id}&select=viewer_identity`);
check(
  "the recorded viewer identity is the share's own recipient_email, not client input",
  lockedViewRow?.viewer_identity === TEST_EMAIL,
  JSON.stringify(lockedViewRow)
);

const reuseCodeView = await fetch(`${APP_URL}/api/view/${shareLocked.token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: realCode }),
});
check("the same code can't be reused (single-use)", reuseCodeView.status === 403);

// Per-share limit (3 per 10 min) protects the recipient's inbox from being
// spammed regardless of which IP the requests come from.
const otpRequestStatuses = [];
for (let i = 0; i < 3; i++) {
  const res = await fetch(`${APP_URL}/api/view/${shareLocked.token}/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL }),
  });
  otpRequestStatuses.push(res.status);
}
check(
  "repeated code requests for the same share eventually get rate-limited (429)",
  otpRequestStatuses.includes(429),
  `statuses: ${otpRequestStatuses.join(",")}`
);

// --- 6. Approve/reject is opt-in, off by default ----------------------------
console.log("\n== Approve/reject decision (opt-in) ==");
const uploadNoDecision = await uploadShare(png, "qa-no-decision-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
});
check("upload without requireDecision returns 201", uploadNoDecision.status === 201);
const { share: shareNoDecision } = await uploadNoDecision.json();
createdShareIds.push(shareNoDecision.id);
check(
  "requireDecision defaults to false in the metadata the viewer page reads",
  (await (await fetch(`${APP_URL}/api/view/${shareNoDecision.token}`)).json()).requireDecision === false
);
const rejectedDecision = await fetch(`${APP_URL}/api/shares/${shareNoDecision.id}/decision`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: shareNoDecision.token, decision: "approved" }),
});
check(
  "submitting a decision on an opted-out share is rejected (400)",
  rejectedDecision.status === 400
);

const uploadWithDecision = await uploadShare(png, "qa-with-decision-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
  requireDecision: "true",
});
check("upload with requireDecision=true returns 201", uploadWithDecision.status === 201);
const { share: shareWithDecision } = await uploadWithDecision.json();
createdShareIds.push(shareWithDecision.id);
check(
  "requireDecision is true in the metadata when the sender opted in",
  (await (await fetch(`${APP_URL}/api/view/${shareWithDecision.token}`)).json()).requireDecision === true
);
const acceptedDecision = await fetch(`${APP_URL}/api/shares/${shareWithDecision.id}/decision`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: shareWithDecision.token, decision: "approved" }),
});
check("submitting a decision on an opted-in share succeeds (200)", acceptedDecision.status === 200);
const [decisionRow] = await restQuery("shares", `id=eq.${shareWithDecision.id}&select=decision`);
check("the decision persisted as approved", decisionRow?.decision === "approved");

// --- 7. View duration tracking: heartbeat + sendBeacon-style final update --
// Runs before the rate-limiting section below, which deliberately exhausts
// the view-route budget with a 25-request burst - placed after that instead,
// a single ordinary view POST here would get 429'd by an unrelated section.
console.log("\n== View duration tracking ==");
const uploadForDuration = await uploadShare(png, "qa-duration-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
});
check("upload share for duration test returns 201", uploadForDuration.status === 201);
const { share: shareForDuration } = await uploadForDuration.json();
createdShareIds.push(shareForDuration.id);

const durationViewRes = await fetch(`${APP_URL}/api/view/${shareForDuration.token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ viewerIdentity: "QA Duration Tester" }),
});
check("opening the file returns 200 with a session id header", durationViewRes.status === 200);
const sessionId = durationViewRes.headers.get("x-view-session-id");
check("a view session id was returned", !!sessionId);

const heartbeat1 = await fetch(`${APP_URL}/api/view/${shareForDuration.token}/heartbeat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, elapsedSeconds: 7 }),
});
check("first heartbeat returns 200", heartbeat1.status === 200);
const [afterFirstBeat] = await restQuery("share_views", `id=eq.${sessionId}&select=duration_seconds`);
check("duration_seconds updated after the first heartbeat", afterFirstBeat?.duration_seconds === 7, JSON.stringify(afterFirstBeat));

// Simulates the sendBeacon call fired on tab close/navigation away with the
// final cumulative elapsed time.
const finalBeat = await fetch(`${APP_URL}/api/view/${shareForDuration.token}/heartbeat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, elapsedSeconds: 134 }),
});
check("final beacon-style update returns 200", finalBeat.status === 200);
const [afterFinalBeat] = await restQuery("share_views", `id=eq.${sessionId}&select=duration_seconds`);
check(
  "duration_seconds reflects the final elapsed time - a killed session keeps partial data too",
  afterFinalBeat?.duration_seconds === 134,
  JSON.stringify(afterFinalBeat)
);

const badPayloadRes = await fetch(`${APP_URL}/api/view/${shareForDuration.token}/heartbeat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId }), // missing elapsedSeconds
});
check("a malformed heartbeat payload is rejected (400)", badPayloadRes.status === 400);

const wrongTokenRes = await fetch(`${APP_URL}/api/view/nonexistent-token-for-heartbeat/heartbeat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, elapsedSeconds: 5 }),
});
check("a heartbeat for a nonexistent share token is rejected (404)", wrongTokenRes.status === 404);

// --- 8. Rate limiting: the view route is capped at 20 requests/min/IP ------
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

// --- 9. Folders: create/rename/move/delete, files fall back to Unfiled -----
console.log("\n== Folders ==");
const createFolderRes = await fetch(`${APP_URL}/api/folders`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ name: "QA Test Folder" }),
});
check("create folder returns 201", createFolderRes.status === 201, await createFolderRes.clone().text());
const { folder } = await createFolderRes.json();
const createdFolderIds = [folder.id];

const listFoldersRes = await fetch(`${APP_URL}/api/folders`, { headers: { Cookie: cookieHeader } });
const { folders: listedFolders } = await listFoldersRes.json();
check("GET /api/folders includes the new folder", listedFolders?.some((f) => f.id === folder.id));

const uploadForFolder = await uploadShare(png, "qa-folder-test.png", "image/png", {
  linkMode: "anyone",
  expiresInHours: "1",
});
check("upload share for folder test returns 201", uploadForFolder.status === 201);
const { share: shareForFolder } = await uploadForFolder.json();
createdShareIds.push(shareForFolder.id);

const moveRes = await fetch(`${APP_URL}/api/shares/${shareForFolder.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ folder_id: folder.id }),
});
check("moving a share into a folder returns 200", moveRes.status === 200);
const [movedRow] = await restQuery("shares", `id=eq.${shareForFolder.id}&select=folder_id`);
check("the share's folder_id was updated", movedRow?.folder_id === folder.id, JSON.stringify(movedRow));

const renameRes = await fetch(`${APP_URL}/api/folders/${folder.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ name: "QA Renamed Folder" }),
});
check("renaming a folder returns 200", renameRes.status === 200);
const [renamedRow] = await restQuery("folders", `id=eq.${folder.id}&select=name`);
check("the folder name persisted", renamedRow?.name === "QA Renamed Folder");

const deleteFolderRes = await fetch(`${APP_URL}/api/folders/${folder.id}`, {
  method: "DELETE",
  headers: { Cookie: cookieHeader },
});
check("deleting a folder returns 200", deleteFolderRes.status === 200);
const [afterDeleteRow] = await restQuery("shares", `id=eq.${shareForFolder.id}&select=folder_id`);
check(
  "the file's folder_id falls back to null (Unfiled), the file itself is not deleted",
  afterDeleteRow?.folder_id === null,
  JSON.stringify(afterDeleteRow)
);

// --- Cleanup ------------------------------------------------------------
console.log("\n== Cleanup ==");
for (const id of createdShareIds) {
  await fetch(`${SUPABASE_URL}/rest/v1/shares?id=eq.${id}`, { method: "DELETE", headers: adminHeaders });
}
for (const id of createdFolderIds) {
  await fetch(`${SUPABASE_URL}/rest/v1/folders?id=eq.${id}`, { method: "DELETE", headers: adminHeaders });
}
console.log(`  Deleted ${createdShareIds.length} test share row(s) (cascades to views/comments).`);
console.log(`  Test account kept: ${TEST_EMAIL} / ${TEST_PASSWORD} (log in at ${APP_URL}/login)`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
