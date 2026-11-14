-- Failed-attempt log used by edge functions to throttle public, credential-guessing endpoints
-- (currently resolve-worker-login). Only the service role touches it: RLS is on and no policy exists.
create table if not exists public.auth_throttle (
  id bigint generated always as identity primary key,
  bucket text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_throttle_lookup_idx on public.auth_throttle (bucket, key, created_at desc);
alter table public.auth_throttle enable row level security;
revoke all on public.auth_throttle from anon, authenticated;
