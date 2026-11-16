-- 기록용 조회 (대표 승인 2026-11-16): after "출발했어요" or turning today's alarm
-- off, the worker still runs while the bus the person was last told to take
-- has not passed yet (alarm-runtime automaticOptions.watchUntil, also per
-- trip), so its real passing time is recorded. Nothing rings: the server only
-- checks that one stop, about once a minute, and never past watchUntil.
-- Everything else is unchanged from the live definition.
create or replace function smart_metro_private.enqueue_alarm_jobs()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; token text; job uuid; count integer := 0;
begin
  if not (select enabled from smart_metro_private.alarm_control where singleton) then return 0; end if;
  for r in select d.user_id from public.smart_metro_documents d
    left join smart_metro_private.alarm_jobs j on j.user_id=d.user_id
    where d.document_key='app-state' and (
      (d.payload#>>'{commute,planningBindingKey}' is not null
       and d.payload#>>'{live,provider}' in ('gyeonggi','seoul','tago','subway')
       and case when d.payload#>>'{user,requiredArrivalTime}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         then ((now() at time zone 'Asia/Seoul')::date + (d.payload#>>'{user,requiredArrivalTime}')::time)
           between (now() at time zone 'Asia/Seoul') and ((now() at time zone 'Asia/Seoul') + interval '6 hours') else false end
       and coalesce(d.payload#>>'{schedule,snoozeDate}','') <> to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD'))
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload->'tripSchedules')='array' then d.payload->'tripSchedules' else '[]'::jsonb end) t
        where t->>'enabled'='true' and t#>>'{departure,live,provider}' in ('gyeonggi','seoul','tago','subway')
          and coalesce(t->>'snoozeDate','') <> to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')
          and case when t->>'requiredArrivalTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            then ((now() at time zone 'Asia/Seoul')::date + (t->>'requiredArrivalTime')::time)
              between (now() at time zone 'Asia/Seoul') and ((now() at time zone 'Asia/Seoul') + interval '6 hours') else false end)
      or exists (select 1 from public.smart_metro_documents rt
        cross join lateral (
          select rt.payload#>>'{automaticOptions,watchUntil}' as w
          union all
          select c.value#>>'{runtime,automaticOptions,watchUntil}'
            from jsonb_each(case when jsonb_typeof(rt.payload->'tripContexts')='object' then rt.payload->'tripContexts' else '{}'::jsonb end) c
        ) x
        where rt.user_id=d.user_id and rt.document_key='alarm-runtime'
          and case when x.w ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
            then x.w::timestamptz > now() and x.w::timestamptz < now() + interval '3 hours' else false end))
      and (j.user_id is null or j.expires_at<=now())
    order by j.scheduled_at nulls first limit 20
  loop
    token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''); job := gen_random_uuid();
    insert into smart_metro_private.alarm_jobs(user_id,job_id,token_hash,expires_at,claimed,checkpointed,scheduled_at,last_status)
      values(r.user_id,job,sha256(convert_to(token,'UTF8')),now()+interval '2 minutes',false,false,now(),'pending')
      on conflict(user_id) do update set job_id=excluded.job_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at,claimed=false,checkpointed=false,scheduled_at=now(),last_status='pending';
    perform net.http_post(url:='https://smart-metro.vercel.app/api/alarm-worker',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('jobId',job,'token',token),timeout_milliseconds:=55000);
    count := count+1;
  end loop;
  return count;
end; $$;
revoke all on function smart_metro_private.enqueue_alarm_jobs() from public,anon,authenticated;

-- Daily purge of de-identified purchase ledger rows past the 5-year retention
-- (applied 2026-11-16 with 대표 approval; recorded here for the history).
-- select cron.schedule('inochi-purge-purchase-ledger', '17 3 * * *', 'select smart_metro_private.inochi_purge_purchase_ledger();');
