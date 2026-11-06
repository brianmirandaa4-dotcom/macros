-- tail. community schema: members, friendships, shared bets. Row-level security on every table.
-- Each phone signs in anonymously (Supabase anonymous auth), so auth.uid() is that phone's member id.

create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  name text not null check (char_length(name) between 1 and 24),
  share_bets boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

create table if not exists public.bets (
  id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bet jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.bets enable row level security;

-- profiles: any signed-in member can look up usernames (to add friends); you can only create/edit your own
drop policy if exists p_read on public.profiles;   create policy p_read on public.profiles for select to authenticated using (true);
drop policy if exists p_ins on public.profiles;    create policy p_ins on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists p_upd on public.profiles;    create policy p_upd on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- friendships: see your own; send as yourself; only the addressee can accept; either side can remove
drop policy if exists f_read on public.friendships; create policy f_read on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
drop policy if exists f_ins on public.friendships;  create policy f_ins on public.friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
drop policy if exists f_upd on public.friendships;  create policy f_upd on public.friendships for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists f_del on public.friendships;  create policy f_del on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

-- bets: yours always; a friend's only if you are accepted friends AND they switched sharing on
drop policy if exists b_read on public.bets; create policy b_read on public.bets for select to authenticated using (
  user_id = auth.uid()
  or (public.are_friends(auth.uid(), user_id) and exists (select 1 from public.profiles p where p.id = user_id and p.share_bets)));
drop policy if exists b_write on public.bets; create policy b_write on public.bets for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
