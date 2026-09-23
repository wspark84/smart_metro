-- Apply after the worker endpoint is deployed and the capability migration passes.
-- Initially disabled; activation is a separate operator action.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function smart_metro_private.enqueue_alarm_jobs()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; token text; job uuid; count integer := 0;
begin
  if not (select enabled from smart_metro_private.alarm_control where singleton) then return 0; end if;
  for r in select d.user_id from public.smart_metro_documents d
    left join smart_metro_private.alarm_jobs j on j.user_id=d.user_id
    where d.document_key='app-state' and d.payload#>>'{commute,planningBindingKey}' is not null
      and d.payload#>>'{live,provider}' in ('gyeonggi','seoul','tago','subway')
      and d.payload#>>'{user,requiredArrivalTime}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and ((now() at time zone 'Asia/Seoul')::date + (d.payload#>>'{user,requiredArrivalTime}')::time)
        between (now() at time zone 'Asia/Seoul') and ((now() at time zone 'Asia/Seoul') + interval '6 hours')
      and coalesce(d.payload#>>'{schedule,snoozeDate}','') <> to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')
      and (j.user_id is null or j.expires_at<=now())
    order by j.scheduled_at nulls first limit 20
  loop
    token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
    job := gen_random_uuid();
    insert into smart_metro_private.alarm_jobs(user_id,job_id,token_hash,expires_at,claimed,checkpointed,scheduled_at,last_status)
      values(r.user_id,job,sha256(convert_to(token,'UTF8')),now()+interval '2 minutes',false,false,now(),'pending')
      on conflict(user_id) do update set job_id=excluded.job_id,token_hash=excluded.token_hash,
        expires_at=excluded.expires_at,claimed=false,checkpointed=false,scheduled_at=now(),last_status='pending';
    perform net.http_post(url:='https://smart-metro.vercel.app/api/alarm-worker',
      headers:='{"Content-Type":"application/json"}'::jsonb,
      body:=jsonb_build_object('jobId',job,'token',token),timeout_milliseconds:=55000);
    count := count+1;
  end loop;
  return count;
end; $$;
revoke all on function smart_metro_private.enqueue_alarm_jobs() from public,anon,authenticated;
select cron.schedule('smart-metro-alarm-worker','* * * * *','select smart_metro_private.enqueue_alarm_jobs();');
commit;
