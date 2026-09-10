# OnceOver

Sharing tool for designers, VFX artists, and production houses to send images and PDFs with
real control over how long they stay viewable — a time window, a view-count limit, or both.
Every file is watermarked with the viewer's identity and timestamp before it's ever displayed,
and the sender is notified the instant it's opened.

## Stack

| Layer | Choice |
|---|---|
| Frontend + API | Next.js (App Router) |
| Auth + Database | Supabase (Postgres) |
| File storage | Cloudflare R2 |
| Image watermarking | Sharp |
| PDF watermarking | pdf-lib |
| Scheduled cleanup | Vercel Cron (`/api/cron/cleanup`) |
| Notifications | Resend |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql) — it creates the
   `shares`, `share_views`, and `share_comments` tables plus Row Level Security policies.
3. Under **Authentication > Providers**, email/password sign-up is enabled by default, which is
   all this app uses.
4. Copy the Project URL, anon key, and service role key from **Project Settings > API**.

### 3. Create a Cloudflare R2 bucket

1. Create a bucket (e.g. `onceover-files`) in the Cloudflare dashboard.
2. Create an R2 API token with read/write access to that bucket.
3. Note the account-scoped R2 endpoint (`https://<account-id>.r2.cloudflarestorage.com`).

### 4. Create a Resend account

1. Sign up at [resend.com](https://resend.com) and verify a sending domain (or use their test domain while developing).
2. Grab an API key.

### 5. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in the Supabase, R2, Resend, and `CRON_SECRET` (any random string) values.

### 6. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

1. A sender signs up, uploads a PNG/JPEG/WEBP/PDF, and sets an expiry rule (time-based,
   view-count based, or both) plus a link mode (anyone with the link, or a specific recipient
   email) — see [`src/app/upload/page.tsx`](./src/app/upload/page.tsx).
2. The original file is stored in R2, untouched — see [`src/lib/r2.ts`](./src/lib/r2.ts).
3. When a recipient opens the share link (`/s/[token]`), they enter their name/email, and the
   server fetches the original from R2, burns a tiled watermark of their identity + timestamp
   directly into the pixels (images via Sharp, PDFs via pdf-lib — see
   [`src/lib/watermark.ts`](./src/lib/watermark.ts)), records the view, and emails the sender —
   see [`src/app/api/view/[token]/route.ts`](<./src/app/api/view/[token]/route.ts>).
4. The viewer page disables right-click, drag, and text selection, and serves the file as an
   in-memory blob rather than a static downloadable URL.
5. Recipients can mark the file **Approved**/**Rejected** and leave threaded comments; the
   sender replies from their dashboard.
6. `/api/cron/cleanup`, triggered every 15 minutes by [`vercel.json`](./vercel.json), sweeps any
   share whose time or view limit has passed and permanently deletes the R2 object.

## Testing

```bash
npm test        # unit tests (expiry logic, watermarking) - no external services needed
npm run test:e2e  # integration test against a REAL Supabase/R2/Resend backend
```

`npm test` runs [Vitest](https://vitest.dev) against the pure logic in `src/lib` — `isExpired()`
and the Sharp/pdf-lib watermark functions — and needs nothing but `npm install`.

`npm run test:e2e` runs [`scripts/e2e-test.mjs`](./scripts/e2e-test.mjs), which drives the actual
API routes over HTTP against your real `.env.local` credentials: signup/login, an authenticated
upload, a genuinely concurrent race on a 1-view link (this is what originally caught a
delete-before-read bug in the expiry logic that unit tests alone did not), the PDF watermark
path, and the `/api/cron/cleanup` sweep. It requires `npm run dev` running in another terminal,
`TEST_EMAIL`/`TEST_PASSWORD` set in `.env.local` (not hardcoded in the script - this repo is
public, so credentials only ever belong in the gitignored `.env.local`), and creates/cleans up
its own test data:

```bash
set -a && source .env.local && set +a && npm run test:e2e
```

Use an email you're fine with Resend sending test notifications to. Resend's sandbox mode
restricts delivery to the account owner's own address, but that lifts once a sending domain is
verified (see Deploying below) - at that point any real inbox works.

## Deploying

Deploy to Vercel and add the same environment variables from `.env.local` to the project's
environment variable settings (update `NEXT_PUBLIC_APP_URL` to the production URL). The cron
schedule in `vercel.json` is picked up automatically on Vercel; `CRON_SECRET` authorizes those
requests via the `Authorization: Bearer` header.

The cron runs once daily (`0 3 * * *`) rather than every 15 minutes - Vercel's free Hobby plan
caps Cron Jobs at once per day, and a more frequent schedule fails validation on that plan. A
share that expires by time but is never opened just sits in R2 until the next daily sweep; a
share someone actually tries to open past its expiry is still deleted immediately by the view
route regardless of the cron. If you're on Vercel Pro, tighten the schedule back to `*/15 * * * *`
for faster cleanup of never-opened expired shares.
