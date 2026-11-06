-- tail. BET NOW push alerts: subscriptions, dedupe log, cron secret check. Row-level security on every table.
-- Run once in the Supabase SQL editor. Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- one row per phone's push subscription; a member manages only their own rows
create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;
drop policy if exists ps_read on public.push_subs; create policy ps_read on public.push_subs for select to authenticated using (user_id = auth.uid());
drop policy if exists ps_ins on public.push_subs;  create policy ps_ins on public.push_subs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ps_upd on public.push_subs;  create policy ps_upd on public.push_subs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ps_del on public.push_subs;  create policy ps_del on public.push_subs for delete to authenticated using (user_id = auth.uid());

-- save this phone's subscription for the signed-in member. The endpoint is a capability held by the device,
-- so if the phone re-signed-in as a new anonymous user, the old row for the same endpoint moves to the new user.
create or replace function public.push_sub_save(p_endpoint text, p_p256dh text, p_auth text, p_enabled boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into push_subs (user_id, endpoint, p256dh, auth, enabled) values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_enabled)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, enabled = excluded.enabled;
end $$;
revoke all on function public.push_sub_save(text, text, text, boolean) from public, anon;
grant execute on function public.push_sub_save(text, text, text, boolean) to authenticated;

-- each BET NOW trigger is sent once. Only the Edge Function (service role) reads or writes it.
create table if not exists public.sent_alerts (
  id bigint generated always as identity primary key,
  prop_id text not null,
  side text not null check (side in ('over','under')),
  line numeric not null,
  body text,
  sent_at timestamptz not null default now(),
  unique (prop_id, side, line)
);
alter table public.sent_alerts enable row level security;

-- cron secret: generated inside the database, kept in Vault, never leaves it
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'live_alerts_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'live_alerts_cron', 'x-cron-secret for the live-alerts Edge Function');
  end if; end $$;
create or replace function public.live_alerts_auth(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'live_alerts_cron' and decrypted_secret = s);
$$;
revoke all on function public.live_alerts_auth(text) from public, anon, authenticated;
grant execute on function public.live_alerts_auth(text) to service_role;

-- every minute during NFL game windows (13:00-05:59 UTC covers London, 1 PM, 4 PM, SNF, MNF, TNF, Saturday and holiday games);
-- the function itself no-ops unless a slate window is open and a modeled game is live
select cron.unschedule(jobid) from cron.job where jobname in ('live-alerts', 'live-alerts-cleanup');
select cron.schedule('live-alerts', '* 0-5,13-23 * * *', $job$
  select net.http_post(
    url := 'https://zsstjpnqqrxkzrfuejww.supabase.co/functions/v1/live-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpzc3RqcG5xcXJ4a3pyZnVland3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MzQ3MDcsImV4cCI6MjEwOTUxMDcwN30.JoJsAUYDbkQl-KWMs5Hk9ZiZFZMdDDeLq3f91ZLFU5s',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'live_alerts_cron')),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
$job$);
-- keep the free-plan database small: cron run log 2 days, alert log 30 days
select cron.schedule('live-alerts-cleanup', '17 9 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from public.sent_alerts where sent_at < now() - interval '30 days';
$job$);
