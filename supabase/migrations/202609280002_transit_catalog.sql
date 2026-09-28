begin;
create table if not exists smart_metro_private.catalog_scopes (
 id bigint generated always as identity primary key,
 spec jsonb not null unique, page integer not null default 1,
 run_id uuid not null default gen_random_uuid(), published_run uuid,
 next_at timestamptz not null default now(), checked_at timestamptz,
 total integer, failures integer not null default 0, last_error text,
 check(spec->>'service' in ('stops','routes')),
 check(spec->>'operation' in ('getCtyCodeList','getSttnNoList','getRouteNoList','getRouteInfoIem','getRouteAcctoThrghSttnList'))
);
create table if not exists smart_metro_private.catalog_pages (
 scope_id bigint references smart_metro_private.catalog_scopes(id), run_id uuid,
 page integer, rows jsonb not null, primary key(scope_id,run_id,page)
);
create table if not exists smart_metro_private.catalog_stations (
 scope_id bigint references smart_metro_private.catalog_scopes(id), station_id text,
 lat double precision, lng double precision, payload jsonb not null, checked_at timestamptz not null,
 primary key(scope_id,station_id)
);
create index if not exists catalog_station_position on smart_metro_private.catalog_stations(lat,lng);
create table if not exists smart_metro_private.catalog_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 daily_budget integer not null default 2000 check(daily_budget between 1 and 8000)
);
insert into smart_metro_private.catalog_control(singleton) values(true) on conflict do nothing;
create table if not exists smart_metro_private.catalog_usage (
 service text, day date, attempts integer not null default 0, blocked_until timestamptz, primary key(service,day)
);
create table if not exists smart_metro_private.catalog_job (
 singleton boolean primary key default true check(singleton), job_id uuid, token_hash bytea,
 scope_id bigint references smart_metro_private.catalog_scopes(id), expires_at timestamptz,
 claimed boolean not null default false
);
revoke all on smart_metro_private.catalog_scopes,smart_metro_private.catalog_pages,smart_metro_private.catalog_stations,
 smart_metro_private.catalog_control,smart_metro_private.catalog_usage,smart_metro_private.catalog_job from public,anon,authenticated;

insert into smart_metro_private.catalog_scopes(spec) values
 ('{"service":"stops","operation":"getCtyCodeList","params":{}}'),
 ('{"service":"routes","operation":"getCtyCodeList","params":{}}') on conflict do nothing;

create or replace function smart_metro_private.enqueue_catalog_job()
returns boolean language plpgsql security definer set search_path='' as $$
declare s smart_metro_private.catalog_scopes; token text; job uuid;
 today date := (now() at time zone 'Asia/Seoul')::date; budget integer;
begin
 if not pg_try_advisory_xact_lock(928002) then return false; end if;
 select daily_budget into budget from smart_metro_private.catalog_control where singleton and enabled;
 if not found then return false; end if;
 if exists(select 1 from smart_metro_private.catalog_job where expires_at>now()) then return false; end if;
 select c.* into s from smart_metro_private.catalog_scopes c
 left join smart_metro_private.catalog_usage u on u.service=c.spec->>'service' and u.day=today
 where c.next_at<=now() and coalesce(u.attempts,0)<budget and (u.blocked_until is null or u.blocked_until<=now())
 order by case c.spec->>'operation' when 'getCtyCodeList' then 0 else 1 end,c.next_at,c.id limit 1 for update of c;
 if not found then return false; end if;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''); job:=gen_random_uuid();
 insert into smart_metro_private.catalog_usage(service,day,attempts) values(s.spec->>'service',today,1)
 on conflict(service,day) do update set attempts=catalog_usage.attempts+1;
 insert into smart_metro_private.catalog_job(singleton,job_id,token_hash,scope_id,expires_at,claimed)
 values(true,job,sha256(convert_to(token,'UTF8')),s.id,now()+interval '45 seconds',false)
 on conflict(singleton) do update set job_id=excluded.job_id,token_hash=excluded.token_hash,scope_id=excluded.scope_id,expires_at=excluded.expires_at,claimed=false;
 perform net.http_post(url:='https://smart-metro.vercel.app/api/catalog-worker',
 headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('jobId',job,'token',token),timeout_milliseconds:=25000);
 return true;
end; $$;
revoke all on function smart_metro_private.enqueue_catalog_job() from public,anon,authenticated;

create or replace function public.claim_smart_metro_catalog_job(p_job_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j smart_metro_private.catalog_job; s smart_metro_private.catalog_scopes;
begin
 if p_token is null or length(p_token)<>64 then raise exception 'Invalid job' using errcode='42501'; end if;
 update smart_metro_private.catalog_job set claimed=true where job_id=p_job_id and token_hash=sha256(convert_to(p_token,'UTF8'))
 and expires_at>now() and not claimed and (select enabled from smart_metro_private.catalog_control where singleton) returning * into j;
 if not found then raise exception 'Invalid job' using errcode='42501'; end if;
 select * into s from smart_metro_private.catalog_scopes where id=j.scope_id;
 return s.spec||jsonb_build_object('page',s.page);
end; $$;
revoke all on function public.claim_smart_metro_catalog_job(uuid,text) from public,authenticated;
grant execute on function public.claim_smart_metro_catalog_job(uuid,text) to anon;

create or replace function public.finish_smart_metro_catalog_job(p_job_id uuid,p_token text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j smart_metro_private.catalog_job; s smart_metro_private.catalog_scopes; child jsonb;
 tomorrow timestamptz := (((now() at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul');
begin
 select * into j from smart_metro_private.catalog_job where job_id=p_job_id and token_hash=sha256(convert_to(p_token,'UTF8')) and expires_at>now() and claimed for update;
 if not found or not (select enabled from smart_metro_private.catalog_control where singleton) then raise exception 'Invalid job' using errcode='42501'; end if;
 select * into s from smart_metro_private.catalog_scopes where id=j.scope_id for update;
 if p_result ? 'error' then
  if p_result->>'error' in ('TAGO_20','TAGO_22','TAGO_23','TAGO_30','TAGO_31','KEY_MISSING','HTTP_429') then
   insert into smart_metro_private.catalog_usage(service,day,blocked_until)
   values(s.spec->>'service',(now() at time zone 'Asia/Seoul')::date,
    case when p_result->>'error'='HTTP_429' then now()+interval '30 minutes' else tomorrow end)
   on conflict(service,day) do update set blocked_until=excluded.blocked_until;
  end if;
  update smart_metro_private.catalog_scopes set failures=failures+1,last_error=left(p_result->>'error',40),
   next_at=case when p_result->>'error' in ('TAGO_20','TAGO_22','TAGO_30','TAGO_31','KEY_MISSING') then tomorrow else now()+interval '30 minutes' end where id=s.id;
 else
  if jsonb_typeof(p_result->'rows') is distinct from 'array' or jsonb_array_length(p_result->'rows')>1000 or octet_length(p_result::text)>2000000
    or jsonb_typeof(p_result->'children') is distinct from 'array' or jsonb_array_length(p_result->'children')>1000 then raise exception 'Invalid result'; end if;
  if s.page>1 and s.total is distinct from (p_result->>'total')::integer then
    update smart_metro_private.catalog_scopes set page=1,run_id=gen_random_uuid(),total=null,next_at=now()+interval '30 minutes',last_error='TOTAL_CHANGED' where id=s.id;
  else
   insert into smart_metro_private.catalog_pages values(s.id,s.run_id,s.page,p_result->'rows') on conflict(scope_id,run_id,page) do update set rows=excluded.rows;
   for child in select value from jsonb_array_elements(p_result->'children') loop
    if child ? 'serviceKey' or child->'params' ? 'serviceKey' then raise exception 'Forbidden field'; end if;
    insert into smart_metro_private.catalog_scopes(spec) values(child) on conflict do nothing;
   end loop;
   if (p_result->>'done')::boolean then
    if s.spec->>'operation'='getSttnNoList' then
     insert into smart_metro_private.catalog_stations(scope_id,station_id,lat,lng,payload,checked_at)
     select distinct on(e->>'nodeid') s.id,e->>'nodeid',(e->>'gpslati')::double precision,(e->>'gpslong')::double precision,
      jsonb_build_object('stationId',e->>'nodeid','nodeId',e->>'nodeid','stationName',e->>'nodenm',
       'stationNumber',coalesce(e->>'nodeno',''),'cityCode',s.spec#>>'{params,cityCode}',
       'posX',e->>'gpslong','posY',e->>'gpslati','provider','tago'),now()
     from smart_metro_private.catalog_pages p cross join lateral jsonb_array_elements(p.rows) e
     where p.scope_id=s.id and p.run_id=s.run_id and e->>'nodeid' is not null
      and e->>'gpslati' ~ '^[0-9]+(\.[0-9]+)?$' and e->>'gpslong' ~ '^[0-9]+(\.[0-9]+)?$'
     on conflict(scope_id,station_id) do update set lat=excluded.lat,lng=excluded.lng,payload=excluded.payload,checked_at=excluded.checked_at;
    end if;
    update smart_metro_private.catalog_scopes set published_run=s.run_id,checked_at=now(),next_at=tomorrow,page=1,run_id=gen_random_uuid(),total=null,failures=0,last_error=null where id=s.id;
    delete from smart_metro_private.catalog_pages where scope_id=s.id and run_id<>s.run_id;
   else
    update smart_metro_private.catalog_scopes set page=page+1,total=(p_result->>'total')::integer,next_at=now(),last_error=null where id=s.id;
   end if;
  end if;
 end if;
 update smart_metro_private.catalog_job set expires_at=now(),claimed=false where singleton;
 return true;
end; $$;
revoke all on function public.finish_smart_metro_catalog_job(uuid,text,jsonb) from public,authenticated;
grant execute on function public.finish_smart_metro_catalog_job(uuid,text,jsonb) to anon;

create or replace function public.read_smart_metro_catalog(p_spec jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('complete',true,'checkedAt',s.checked_at,'rows',
  coalesce((select jsonb_agg(e.value order by p.page,e.ordinality) from smart_metro_private.catalog_pages p
   cross join lateral jsonb_array_elements(p.rows) with ordinality e(value,ordinality)
   where p.scope_id=s.id and p.run_id=s.published_run),'[]'::jsonb))
 from smart_metro_private.catalog_scopes s where s.spec=p_spec
 and s.published_run is not null;
$$;
revoke all on function public.read_smart_metro_catalog(jsonb) from public;
grant execute on function public.read_smart_metro_catalog(jsonb) to anon,authenticated;
create or replace function public.nearby_smart_metro_catalog(p_lat double precision,p_lng double precision)
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(payload),'[]'::jsonb) from (
  select st.payload from smart_metro_private.catalog_stations st
  join smart_metro_private.catalog_scopes sc on sc.id=st.scope_id and sc.checked_at=st.checked_at
  where p_lat between 33 and 39 and p_lng between 124 and 132
   and lat between p_lat-0.005 and p_lat+0.005 and lng between p_lng-0.007 and p_lng+0.007
   and power((lat-p_lat)*111320,2)+power((lng-p_lng)*111320*cos(radians(p_lat)),2)<=250000
  order by power(lat-p_lat,2)+power((lng-p_lng)*cos(radians(p_lat)),2) limit 100
 ) stations;
$$;
revoke all on function public.nearby_smart_metro_catalog(double precision,double precision) from public;
grant execute on function public.nearby_smart_metro_catalog(double precision,double precision) to anon,authenticated;
commit;
