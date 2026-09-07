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

## Deploying

Deploy to Vercel and add the same environment variables from `.env.local` to the project's
environment variable settings. The cron schedule in `vercel.json` is picked up automatically on
Vercel; `CRON_SECRET` authorizes those requests via the `Authorization: Bearer` header.
