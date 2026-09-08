-- OnceOver database schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) for a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- shares: one row per uploaded file + its expiry/access rules
-- ---------------------------------------------------------------------------
create table if not exists public.shares (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  token             text not null unique,

  original_filename text not null,
  mime_type         text not null,
  file_type         text not null check (file_type in ('image', 'pdf')),
  storage_key       text not null,           -- path of the original in the R2 bucket
  file_size_bytes   bigint not null default 0,

  link_mode         text not null default 'anyone' check (link_mode in ('anyone', 'email')),
  recipient_email   text,

  expires_at        timestamptz,             -- null = no time limit
  max_views         integer,                 -- null = no view-count limit
  view_count        integer not null default 0,

  status            text not null default 'active' check (status in ('active', 'expired', 'deleted')),
  decision          text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  require_decision  boolean not null default false, -- opt-in: only show approve/reject to the recipient if the sender asked for it

  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists shares_owner_id_idx on public.shares(owner_id);
create index if not exists shares_token_idx on public.shares(token);
create index if not exists shares_status_idx on public.shares(status);

-- ---------------------------------------------------------------------------
-- views: one row per time the file was opened
-- ---------------------------------------------------------------------------
create table if not exists public.share_views (
  id               uuid primary key default gen_random_uuid(),
  share_id         uuid not null references public.shares(id) on delete cascade,
  viewer_identity  text not null,            -- name/email the viewer typed in, or 'Anonymous'
  viewer_ip        text,
  user_agent       text,
  viewed_at        timestamptz not null default now()
);

create index if not exists share_views_share_id_idx on public.share_views(share_id);

-- ---------------------------------------------------------------------------
-- comments: threaded feedback tied to a share
-- ---------------------------------------------------------------------------
create table if not exists public.share_comments (
  id           uuid primary key default gen_random_uuid(),
  share_id     uuid not null references public.shares(id) on delete cascade,
  author_type  text not null check (author_type in ('sender', 'recipient')),
  author_name  text not null,
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists share_comments_share_id_idx on public.share_comments(share_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.shares enable row level security;
alter table public.share_views enable row level security;
alter table public.share_comments enable row level security;

-- Owners can fully manage their own shares from the browser client.
create policy "owners manage their shares"
  on public.shares for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Owners can read views/comments on shares they own. All writes to these two
-- tables happen server-side with the service-role key (recipients are usually
-- not authenticated Supabase users), so there is no public insert policy.
create policy "owners read views on their shares"
  on public.share_views for select
  using (exists (select 1 from public.shares s where s.id = share_id and s.owner_id = auth.uid()));

create policy "owners read comments on their shares"
  on public.share_comments for select
  using (exists (select 1 from public.shares s where s.id = share_id and s.owner_id = auth.uid()));

create policy "owners insert comments as sender"
  on public.share_comments for insert
  with check (
    author_type = 'sender'
    and exists (select 1 from public.shares s where s.id = share_id and s.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- record_view: atomically enforces the expiry rules and increments the view
-- counter. A plain "read view_count, add one, write it back" in application
-- code is a check-then-act race - two near-simultaneous opens of a
-- "1 view only" link can both read view_count=0 and both get served the
-- file. Locking the row with `for update` serializes concurrent callers so
-- only the caller(s) actually within the limit are accepted.
-- ---------------------------------------------------------------------------
create or replace function public.record_view(p_share_id uuid)
returns table (accepted boolean, view_count integer, newly_expired boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_views  integer;
  v_expires_at timestamptz;
  v_view_count integer;
  v_status     text;
  v_expired    boolean;
  v_newly_expired boolean := false;
begin
  select s.max_views, s.expires_at, s.view_count, s.status
  into v_max_views, v_expires_at, v_view_count, v_status
  from public.shares s
  where s.id = p_share_id
  for update;

  if not found then
    return query select false, 0, false;
    return;
  end if;

  v_expired := v_status <> 'active'
    or (v_expires_at is not null and v_expires_at <= now())
    or (v_max_views is not null and v_view_count >= v_max_views);

  if v_expired then
    if v_status = 'active' then
      update public.shares set status = 'expired', deleted_at = now() where id = p_share_id;
      v_newly_expired := true;
    end if;
    return query select false, v_view_count, v_newly_expired;
    return;
  end if;

  v_view_count := v_view_count + 1;

  if v_max_views is not null and v_view_count >= v_max_views then
    update public.shares set view_count = v_view_count, status = 'expired', deleted_at = now() where id = p_share_id;
    v_newly_expired := true;
  else
    update public.shares set view_count = v_view_count where id = p_share_id;
  end if;

  return query select true, v_view_count, v_newly_expired;
end;
$$;

grant execute on function public.record_view(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- rate_limits / check_rate_limit: a fixed-window rate limiter backed by
-- Postgres rather than in-memory state. The app runs on Vercel's stateless
-- serverless functions, where in-memory counters don't persist reliably
-- across invocations - state has to live somewhere shared, and this reuses
-- infrastructure already in place instead of adding a separate service.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key         text primary key,
  window_start timestamptz not null default now(),
  count       integer not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies: only reachable through the security-definer function below.

create or replace function public.check_rate_limit(p_key text, p_max_attempts integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
  set count = case
        when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          then 1
        else public.rate_limits.count + 1
      end,
      window_start = case
        when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          then now()
        else public.rate_limits.window_start
      end
  returning count into v_count;

  return v_count <= p_max_attempts;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- share_otps / verify_share_otp: proves the viewer of an email-locked share
-- actually controls the recipient inbox, not just that they know/guessed the
-- address. A plaintext, single-use, 10-minute code is a reasonable tradeoff
-- here (not a long-lived credential like a password) - it's already gated by
-- request-rate-limiting per share and a per-code attempt cap below.
-- ---------------------------------------------------------------------------
create table if not exists public.share_otps (
  id          uuid primary key default gen_random_uuid(),
  share_id    uuid not null references public.shares(id) on delete cascade,
  code        text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists share_otps_share_id_idx on public.share_otps(share_id);

alter table public.share_otps enable row level security;
-- No policies: only reachable through the security-definer function below.

create or replace function public.verify_share_otp(p_share_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_expires_at timestamptz;
  v_consumed_at timestamptz;
  v_attempts integer;
begin
  -- Only the most recently requested code for this share is valid - an
  -- earlier one is implicitly superseded once a fresh code is sent.
  select id, code, expires_at, consumed_at, attempts
  into v_id, v_code, v_expires_at, v_consumed_at, v_attempts
  from public.share_otps
  where share_id = p_share_id
  order by created_at desc
  limit 1
  for update;

  if v_id is null or v_consumed_at is not null or v_expires_at <= now() or v_attempts >= 5 then
    return false;
  end if;

  if v_code <> p_code then
    update public.share_otps set attempts = attempts + 1 where id = v_id;
    return false;
  end if;

  update public.share_otps set consumed_at = now() where id = v_id;
  return true;
end;
$$;

grant execute on function public.verify_share_otp(uuid, text) to service_role;
