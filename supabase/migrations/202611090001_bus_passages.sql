-- 이노치 예상시간표: when buses actually passed each stop, shared by every user
-- of the same stop and route (대표 결정 2026-11-09). Learned from live arrivals
-- the app already checks: a bus that was a few minutes away and is replaced by
-- a later one has passed. Public transit timing only; no personal data is
-- returned, the recording account is kept for abuse handling.
begin;

create table if not exists smart_metro_private.bus_passages (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('seoul','gyeonggi','tago')),
  city_code text not null default '' check (city_code ~ '^[0-9]{0,10}$'),
  station_id text not null check (station_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  route_id text not null check (route_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  route_number text not null default '' check (length(route_number) <= 40),
  passed_at timestamptz not null,
  service_date date not null,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
comment on table smart_metro_private.bus_passages is '버스 정류소 통과 기록 (정류소 ID, 노선 ID·번호, 통과 시각). 이노치 예상시간표의 원천 데이터';
create index if not exists bus_passages_lookup
  on smart_metro_private.bus_passages(provider, city_code, station_id, route_id, service_date);
revoke all on smart_metro_private.bus_passages from public, anon, authenticated;

-- Who may call: a signed-in person (app) or a running alarm job (background).
create or replace function smart_metro_private.bus_passage_caller(p_job_id uuid, p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null and p_job_id is not null and length(coalesce(p_token,'')) = 64 then
    select user_id into caller from smart_metro_private.alarm_jobs
      where job_id = p_job_id and token_hash = sha256(convert_to(p_token,'UTF8')) and claimed and expires_at > now();
  end if;
  if caller is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  return caller;
end; $$;
revoke all on function smart_metro_private.bus_passage_caller(uuid,text) from public, anon, authenticated;

-- Records up to 20 passages. Only recent times are accepted, and the same bus
-- (within 3 minutes on the same stop and route) is kept once.
create or replace function public.record_smart_metro_bus_passages(p_passages jsonb, p_job_id uuid default null, p_token text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare caller uuid := smart_metro_private.bus_passage_caller(p_job_id, p_token);
  r jsonb; at timestamptz; added integer := 0;
begin
  if jsonb_typeof(p_passages) is distinct from 'array' or jsonb_array_length(p_passages) > 20 then
    raise exception 'Invalid passages' using errcode = '22023'; end if;
  for r in select value from jsonb_array_elements(p_passages) loop
    begin at := (r->>'passedAt')::timestamptz; exception when others then continue; end;
    if at is null or at > now() + interval '2 minutes' or at < now() - interval '30 minutes' then continue; end if;
    if coalesce(r->>'provider','') not in ('seoul','gyeonggi','tago')
      or coalesce(r->>'cityCode','') !~ '^[0-9]{0,10}$'
      or coalesce(r->>'stationId','') !~ '^[A-Za-z0-9_-]{1,40}$'
      or coalesce(r->>'routeId','') !~ '^[A-Za-z0-9_-]{1,40}$' then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', r->>'provider', coalesce(r->>'cityCode',''), r->>'stationId', r->>'routeId'), 0));
    if exists (select 1 from smart_metro_private.bus_passages b
      where b.provider = r->>'provider' and b.city_code = coalesce(r->>'cityCode','')
        and b.station_id = r->>'stationId' and b.route_id = r->>'routeId'
        and b.passed_at between at - interval '3 minutes' and at + interval '3 minutes') then continue; end if;
    insert into smart_metro_private.bus_passages(provider, city_code, station_id, route_id, route_number, passed_at, service_date, recorded_by)
      values (r->>'provider', coalesce(r->>'cityCode',''), r->>'stationId', r->>'routeId', left(coalesce(r->>'routeNumber',''), 40),
        at, (at at time zone 'Asia/Seoul')::date, caller);
    added := added + 1;
  end loop;
  return added;
end; $$;
revoke all on function public.record_smart_metro_bus_passages(jsonb,uuid,text) from public;
grant execute on function public.record_smart_metro_bus_passages(jsonb,uuid,text) to anon, authenticated;

-- Last 10 weeks of passages for up to 12 stop/route pairs, as minutes of the
-- day (KST) per service date: [{provider,cityCode,stationId,routeId,days:{date:[min,...]}}].
create or replace function public.smart_metro_bus_passage_days(p_bindings jsonb, p_job_id uuid default null, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := smart_metro_private.bus_passage_caller(p_job_id, p_token); result jsonb;
begin
  if jsonb_typeof(p_bindings) is distinct from 'array' or jsonb_array_length(p_bindings) > 12 then
    raise exception 'Invalid bindings' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('provider', k->>'provider', 'cityCode', coalesce(k->>'cityCode',''),
      'stationId', k->>'stationId', 'routeId', k->>'routeId', 'days', coalesce((
        select jsonb_object_agg(d.service_date::text, d.minutes) from (
          select b.service_date, jsonb_agg(extract(hour from b.passed_at at time zone 'Asia/Seoul')::int * 60
              + extract(minute from b.passed_at at time zone 'Asia/Seoul')::int order by b.passed_at) minutes
          from smart_metro_private.bus_passages b
          where b.provider = k->>'provider' and b.city_code = coalesce(k->>'cityCode','')
            and b.station_id = k->>'stationId' and b.route_id = k->>'routeId'
            and b.service_date >= (now() at time zone 'Asia/Seoul')::date - 70
          group by b.service_date) d), '{}'::jsonb))), '[]'::jsonb)
    into result from jsonb_array_elements(p_bindings) k;
  return result;
end; $$;
revoke all on function public.smart_metro_bus_passage_days(jsonb,uuid,text) from public;
grant execute on function public.smart_metro_bus_passage_days(jsonb,uuid,text) to anon, authenticated;
commit;
