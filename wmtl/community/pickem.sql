-- tail. Pick'em: free Over/Under picks on a daily card, friends-only leaderboards. No money, no staking.
-- Run in the Supabase SQL editor after schema.sql (needs profiles, friendships, are_friends). Safe to re-run.
--
-- Tamper-safety: the card and every result are written ONLY by the database itself (pg_cron -> pickem_tick, security definer),
-- from the app's own published slate JSON on GitHub Pages. Clients can read the card and write only their own picks,
-- and only before that game's kickoff (checked against the server clock by RLS). Scores are computed server-side.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- internal (no client access at all)
create table if not exists public.pickem_src (
  id int primary key default 1 check (id = 1),
  base text not null check (base ~ '^https://')
);
insert into public.pickem_src (id, base) values (1, 'https://brianmirandaa4-dotcom.github.io/macros/wmtl/')
  on conflict (id) do update set base = excluded.base;

create table if not exists public.pickem_fetch (
  req bigint primary key,                       -- pg_net request id
  kind text not null check (kind in ('index', 'slate')),
  slate_id text,
  sent_at timestamptz not null default now(),
  done_at timestamptz,
  note text
);
alter table public.pickem_src enable row level security;
alter table public.pickem_fetch enable row level security;
revoke all on public.pickem_src, public.pickem_fetch from anon, authenticated;

-- ---------------------------------------------------------------- the card (server-written, everyone signed in can read)
create table if not exists public.pickem_props (
  id text primary key,                          -- the slate's prop id
  day date not null,                            -- ET calendar day of kickoff
  slate_id text not null,
  sport text not null,
  gid text not null,
  kick_utc timestamptz not null,                -- picks lock here
  player text not null,
  team text, opp text,
  market text not null, market_label text,
  line numeric not null,                        -- frozen when the card is built
  slate_side text,                              -- the slate's own side (for result fallback)
  model_side text not null check (model_side in ('over', 'under')),
  model_p numeric,
  projection numeric,
  ord int not null,
  actual numeric,
  outcome text check (outcome in ('over', 'under', 'push', 'void')),
  graded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pickem_props_day on public.pickem_props (day, ord);
alter table public.pickem_props enable row level security;
revoke all on public.pickem_props from anon, authenticated;
grant select on public.pickem_props to authenticated;
drop policy if exists pp_read on public.pickem_props;
create policy pp_read on public.pickem_props for select to authenticated using (true);

-- ---------------------------------------------------------------- picks (yours; friends see them only after lock)
create table if not exists public.pickem_picks (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  prop_id text not null references public.pickem_props(id) on delete cascade,
  side text not null check (side in ('over', 'under')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, prop_id)
);
create index if not exists pickem_picks_prop on public.pickem_picks (prop_id);
alter table public.pickem_picks enable row level security;
revoke all on public.pickem_picks from anon, authenticated;
grant select, insert, update, delete on public.pickem_picks to authenticated;

create or replace function public.pickem_open(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pickem_props where id = p and kick_utc > now() and outcome is null);
$$;
revoke all on function public.pickem_open(text) from public, anon;
grant execute on function public.pickem_open(text) to authenticated;

drop policy if exists pk_read on public.pickem_picks;
create policy pk_read on public.pickem_picks for select to authenticated using (
  user_id = auth.uid() or (public.are_friends(auth.uid(), user_id) and not public.pickem_open(prop_id)));
drop policy if exists pk_ins on public.pickem_picks;
create policy pk_ins on public.pickem_picks for insert to authenticated with check (user_id = auth.uid() and public.pickem_open(prop_id));
drop policy if exists pk_upd on public.pickem_picks;
create policy pk_upd on public.pickem_picks for update to authenticated
  using (user_id = auth.uid() and public.pickem_open(prop_id)) with check (user_id = auth.uid() and public.pickem_open(prop_id));
drop policy if exists pk_del on public.pickem_picks;
create policy pk_del on public.pickem_picks for delete to authenticated using (user_id = auth.uid() and public.pickem_open(prop_id));

-- server timestamps only; a pick can't be moved to another prop or member
create or replace function public.pickem_pick_stamp() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.created_at := now();
  else new.created_at := old.created_at; new.user_id := old.user_id; new.prop_id := old.prop_id; end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists pickem_pick_stamp on public.pickem_picks;
create trigger pickem_pick_stamp before insert or update on public.pickem_picks for each row execute function public.pickem_pick_stamp();

-- ---------------------------------------------------------------- build cards + grade from one slate's JSON
create or replace function public.pickem_ingest_slate(sid text, j jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  d record; c record; n int; cap_game int; tight boolean;
  players text[]; gcount jsonb; mcount jsonb; built int := 0; graded int := 0; voided int := 0;
begin
  if j is null or j->'props' is null then return 'no props'; end if;

  -- 1) grade: actual vs the card's frozen line; the slate's won/lost only as a fallback
  with r as (
    select key as pid, nullif(value->>'actual', '')::numeric as actual, value->>'result' as res
    from jsonb_each(coalesce(j->'results'->'props', '{}'::jsonb)))
  update pickem_props pp set actual = r.actual, graded_at = now(), outcome = case
      when r.res = 'void' then 'void'
      when r.actual is not null and r.actual > pp.line then 'over'
      when r.actual is not null and r.actual < pp.line then 'under'
      when r.actual is not null then 'push'
      when r.res = 'push' then 'push'
      when r.res = 'won' and pp.slate_side in ('over', 'under') then pp.slate_side
      when r.res = 'lost' and pp.slate_side = 'over' then 'under'
      when r.res = 'lost' and pp.slate_side = 'under' then 'over'
      else null end
  from r where pp.id = r.pid and pp.slate_id = sid and pp.outcome is null and pp.kick_utc < now();
  get diagnostics graded = row_count;
  -- a graded slate that has no result for a card prop (player ruled out, prop pulled): void it, nobody wins or loses
  if j->'results'->>'status' = 'graded' then
    update pickem_props pp set outcome = 'void', graded_at = now()
    where pp.slate_id = sid and pp.outcome is null and pp.kick_utc < now() - interval '6 hours'
      and not (coalesce(j->'results'->'props', '{}'::jsonb) ? pp.id);
    get diagnostics voided = row_count;
  end if;

  -- 2) build: one card of up to 10 per ET day in this slate, while that day hasn't started and nobody has picked yet
  for d in
    select ((g->>'kick_utc')::timestamptz at time zone 'America/New_York')::date as day,
           min((g->>'kick_utc')::timestamptz) as first_kick, count(*) as ngames
    from jsonb_array_elements(j->'games') g where g->>'kick_utc' is not null
    group by 1
  loop
    if d.first_kick <= now() + interval '10 minutes' then continue; end if;
    if exists (select 1 from pickem_picks k join pickem_props pp on pp.id = k.prop_id where pp.slate_id = sid and pp.day = d.day) then continue; end if;
    delete from pickem_props where slate_id = sid and day = d.day;
    cap_game := greatest(3, ceil(10.0 / greatest(d.ngames, 1)))::int;
    n := 0;
    for tight in select unnest(array[true, false]) loop
      if n >= 10 then exit; end if;
      players := coalesce((select array_agg(player) from pickem_props where slate_id = sid and day = d.day), '{}');
      gcount := '{}'::jsonb; mcount := '{}'::jsonb;
      select coalesce(jsonb_object_agg(gid, c2), '{}') into gcount from (select gid, count(*) c2 from pickem_props where slate_id = sid and day = d.day group by gid) x;
      select coalesce(jsonb_object_agg(market, c2), '{}') into mcount from (select market, count(*) c2 from pickem_props where slate_id = sid and day = d.day group by market) x;
      for c in
        with g as (
          select g->>'id' as gid, (g->>'kick_utc')::timestamptz as kick from jsonb_array_elements(j->'games') g),
        p as (
          select p->>'id' as id, p->>'gid' as gid, p->>'player' as player, p->>'team' as team, p->>'opp' as opp,
                 p->>'market' as market, p->>'market_label' as market_label, (p->>'line')::numeric as line,
                 p->>'side' as side, coalesce(nullif(p->>'p', '')::numeric, nullif(p->>'p_raw', '')::numeric) as q,
                 nullif(p->>'projection', '')::numeric as projection, coalesce(p->>'tier', p->>'classification', '') as tier, g.kick
          from jsonb_array_elements(j->'props') p join g on g.gid = p->>'gid'
          where jsonb_typeof(p->'line') = 'number' and p->>'side' in ('over', 'under')
            and p->>'market' not in ('atd', 'kicker') and coalesce((p->>'no_prediction')::boolean, false) = false
            and coalesce(p->>'player', '') <> ''
            and ((g.kick at time zone 'America/New_York')::date) = d.day and g.kick > now() + interval '10 minutes'),
        s as (
          select p.*, greatest(q, 1 - q) as conf, case when q >= 0.5 then side when side = 'over' then 'under' else 'over' end as mside,
                 percent_rank() over (partition by market order by line) as pop
          from p where q is not null)
        select * from s
        where not exists (select 1 from pickem_props x where x.id = s.id)
        order by conf + 0.06 * pop + case tier when 'bet' then 0.03 when 'live' then 0.02 when 'lean' then 0.015 else 0 end desc, id
      loop
        exit when n >= 10;
        if c.player = any(players) then continue; end if;
        if tight and (c.pop < 0.35 or coalesce((gcount->>c.gid)::int, 0) >= cap_game or coalesce((mcount->>c.market)::int, 0) >= 4) then continue; end if;
        insert into pickem_props (id, day, slate_id, sport, gid, kick_utc, player, team, opp, market, market_label, line, slate_side, model_side, model_p, projection, ord)
          values (c.id, d.day, sid, coalesce(j->>'sport', 'NFL'), c.gid, c.kick, c.player, c.team, c.opp, c.market, c.market_label, c.line, c.side, c.mside, round(c.conf, 4), c.projection, n + 1);
        players := players || c.player;
        gcount := jsonb_set(gcount, array[c.gid], to_jsonb(coalesce((gcount->>c.gid)::int, 0) + 1));
        mcount := jsonb_set(mcount, array[c.market], to_jsonb(coalesce((mcount->>c.market)::int, 0) + 1));
        n := n + 1; built := built + 1;
      end loop;
    end loop;
  end loop;
  return format('built %s, graded %s, voided %s', built, graded, voided);
end $$;
revoke all on function public.pickem_ingest_slate(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- the cron tick: fetch index -> fetch live slates -> ingest
create or replace function public.pickem_tick() returns text
language plpgsql security definer set search_path = public as $$
declare r record; s jsonb; base text; idx jsonb; msg text; out text := '';
begin
  select pickem_src.base into base from pickem_src where id = 1;
  for r in
    select f.req, f.kind, f.slate_id, h.status_code, h.content, h.timed_out, h.error_msg
    from pickem_fetch f join net._http_response h on h.id = f.req where f.done_at is null order by f.req
  loop
    begin
      if r.status_code is distinct from 200 then
        msg := coalesce(r.error_msg, 'http ' || coalesce(r.status_code::text, '?'));
      elsif r.kind = 'index' then
        idx := r.content::jsonb; msg := 'index ok';
        for s in select x from jsonb_array_elements(idx->'slates') x
                 where coalesce(x->>'path', '') ~ '^data/[a-z]+/[A-Za-z0-9_.-]+\.json$'
                   and ((x->>'end_utc')::timestamptz > now() - interval '6 days' or x->'results'->>'status' = 'pending')
        loop
          insert into pickem_fetch (req, kind, slate_id)
            values (net.http_get(base || (s->>'path') || '?t=' || extract(epoch from now())::bigint, timeout_milliseconds := 30000), 'slate', s->>'id');
        end loop;
      else
        msg := pickem_ingest_slate(r.slate_id, r.content::jsonb);
      end if;
    exception when others then msg := 'error: ' || sqlerrm; end;
    update pickem_fetch set done_at = now(), note = msg where req = r.req;
    out := out || coalesce(r.kind, '') || ' ' || coalesce(r.slate_id, '') || ': ' || coalesce(msg, '') || E'\n';
  end loop;
  update pickem_fetch set done_at = now(), note = 'no response' where done_at is null and sent_at < now() - interval '20 minutes';
  if not exists (select 1 from pickem_fetch where kind = 'index' and sent_at > now() - interval '9 minutes') then
    insert into pickem_fetch (req, kind) values (net.http_get(base || 'data/index.json?t=' || extract(epoch from now())::bigint, timeout_milliseconds := 20000), 'index');
    out := out || 'index requested';
  end if;
  delete from pickem_fetch where sent_at < now() - interval '3 days';
  return out;
end $$;
revoke all on function public.pickem_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'pickem-tick';
select cron.schedule('pickem-tick', '*/5 * * * *', $job$ select public.pickem_tick(); $job$);

-- ---------------------------------------------------------------- leaderboards: you + accepted friends only
create or replace function public.pickem_board(p_day date)
returns table(user_id uuid, username text, name text, is_me boolean, picks int, graded int, hits int, misses int, pushes int, model_hits int, card int)
language sql stable security definer set search_path = public as $$
  with mem as (select p.id, p.username::text as username, p.name from profiles p
               where auth.uid() is not null and (p.id = auth.uid() or are_friends(auth.uid(), p.id))),
  c as (select * from pickem_props where day = p_day)
  select m.id, m.username, m.name, m.id = auth.uid(),
    count(*)::int,
    count(*) filter (where c.outcome in ('over', 'under'))::int,
    count(*) filter (where c.outcome = k.side)::int,
    count(*) filter (where c.outcome in ('over', 'under') and c.outcome <> k.side)::int,
    count(*) filter (where c.outcome = 'push')::int,
    count(*) filter (where c.outcome = c.model_side)::int,
    (select count(*) from c)::int
  from mem m join pickem_picks k on k.user_id = m.id join c on c.id = k.prop_id
  group by m.id, m.username, m.name;
$$;
revoke all on function public.pickem_board(date) from public, anon;
grant execute on function public.pickem_board(date) to authenticated;

create or replace function public.pickem_season()
returns table(user_id uuid, username text, name text, is_me boolean, hits int, misses int, pushes int, model_hits int,
              days int, perfect int, beat_model int, rank_now int, rank_prev int)
language sql stable security definer set search_path = public as $$
  with mem as (select p.id, p.username::text as username, p.name from profiles p
               where auth.uid() is not null and (p.id = auth.uid() or are_friends(auth.uid(), p.id))),
  g as (select k.user_id, c.day, c.outcome, k.side, c.model_side
        from pickem_picks k join mem m on m.id = k.user_id join pickem_props c on c.id = k.prop_id where c.outcome is not null),
  cards as (select day, count(*) n, count(*) filter (where outcome is null) open from pickem_props group by day),
  lastday as (select max(day) d from g),
  per_day as (select g.user_id, g.day, count(*) filter (where outcome = side) h, count(*) filter (where outcome = model_side) mh, count(*) np
              from g group by 1, 2),
  dd as (select pd.user_id, count(*) days,
                count(*) filter (where pd.h = cards.n and pd.np = cards.n and cards.open = 0) perfect,
                count(*) filter (where pd.h > pd.mh and cards.open = 0 and not exists (
                  select 1 from pickem_picks k2 join pickem_props c2 on c2.id = k2.prop_id where k2.user_id = pd.user_id and c2.day = pd.day and c2.outcome is null)) beat
         from per_day pd join cards on cards.day = pd.day group by 1),
  a as (select g.user_id,
          count(*) filter (where outcome = side) hits,
          count(*) filter (where outcome in ('over', 'under') and outcome <> side) misses,
          count(*) filter (where outcome = 'push') pushes,
          count(*) filter (where outcome = model_side) model_hits,
          count(*) filter (where outcome = side and day < (select d from lastday)) hits_prev,
          count(*) filter (where outcome in ('over', 'under') and outcome <> side and day < (select d from lastday)) misses_prev,
          count(*) filter (where day < (select d from lastday)) n_prev
        from g group by 1)
  select m.id, m.username, m.name, m.id = auth.uid(), a.hits::int, a.misses::int, a.pushes::int, a.model_hits::int,
         coalesce(dd.days, 0)::int, coalesce(dd.perfect, 0)::int, coalesce(dd.beat, 0)::int,
         (rank() over (order by a.hits desc, a.misses asc))::int,
         case when a.n_prev > 0 then (rank() over (order by (a.n_prev > 0) desc, a.hits_prev desc, a.misses_prev asc))::int end
  from a join mem m on m.id = a.user_id left join dd on dd.user_id = a.user_id;
$$;
revoke all on function public.pickem_season() from public, anon;
grant execute on function public.pickem_season() to authenticated;

-- start now instead of waiting five minutes
select public.pickem_tick();
