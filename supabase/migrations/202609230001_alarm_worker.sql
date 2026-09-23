-- Alarm-only capability jobs. Existing authenticated RLS policies are unchanged.
begin;
create schema if not exists smart_metro_private;
revoke all on schema smart_metro_private from public, anon, authenticated;

create table if not exists smart_metro_private.alarm_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into smart_metro_private.alarm_control(singleton) values (true) on conflict do nothing;
create table if not exists smart_metro_private.alarm_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  job_id uuid not null default gen_random_uuid(),
  token_hash bytea not null,
  expires_at timestamptz not null,
  claimed boolean not null default false,
  source_revision bigint,
  checkpointed boolean not null default false,
  scheduled_at timestamptz not null default now(),
  completed_at timestamptz,
  last_status text not null default 'pending'
);
revoke all on all tables in schema smart_metro_private from public, anon, authenticated;

create or replace function public.smart_metro_alarm_scheduler_status()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('enabled',c.enabled,'lastScheduledAt',j.scheduled_at,
    'lastCompletedAt',j.completed_at,'lastStatus',j.last_status)
  from smart_metro_private.alarm_control c
  left join smart_metro_private.alarm_jobs j on j.user_id = auth.uid()
  where c.singleton and auth.uid() is not null;
$$;
revoke all on function public.smart_metro_alarm_scheduler_status() from public, anon;
grant execute on function public.smart_metro_alarm_scheduler_status() to authenticated;

create or replace function public.claim_smart_metro_alarm_job(p_job_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j smart_metro_private.alarm_jobs; docs jsonb;
begin
  if length(p_token) <> 64 then raise exception 'Invalid job' using errcode='42501'; end if;
  update smart_metro_private.alarm_jobs set claimed=true,last_status='processing',
    source_revision=(select revision from public.smart_metro_documents d where d.user_id=alarm_jobs.user_id and d.document_key='app-state')
  where job_id=p_job_id and token_hash=sha256(convert_to(p_token,'UTF8'))
    and expires_at>now() and not claimed
    and (select enabled from smart_metro_private.alarm_control where singleton)
  returning * into j;
  if not found then raise exception 'Invalid job' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('document_key',document_key,'payload',payload,'revision',revision)),'[]'::jsonb)
    into docs from public.smart_metro_documents where user_id=j.user_id;
  return jsonb_build_object('userId',j.user_id,'documents',docs);
end; $$;
revoke all on function public.claim_smart_metro_alarm_job(uuid,text) from public,authenticated;
grant execute on function public.claim_smart_metro_alarm_job(uuid,text) to anon;

create or replace function public.commit_smart_metro_alarm_job(p_job_id uuid,p_token text,p_documents jsonb,p_finish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j smart_metro_private.alarm_jobs; e jsonb; saved public.smart_metro_documents; result jsonb := '[]'::jsonb;
begin
  select * into j from smart_metro_private.alarm_jobs where job_id=p_job_id
    and token_hash=sha256(convert_to(p_token,'UTF8')) and claimed and expires_at>now()
    and last_status='processing' for update;
  if not found then raise exception 'Invalid job' using errcode='42501'; end if;
  if not (select enabled from smart_metro_private.alarm_control where singleton) then
    raise exception 'Worker disabled' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.user_id::text,0));
  -- A changed trip must not create alerts for settings captured before the change.
  if not j.checkpointed and j.source_revision is distinct from
    (select revision from public.smart_metro_documents where user_id=j.user_id and document_key='app-state') then
    raise exception 'Settings changed' using errcode='PT409'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>8 then
    raise exception 'Invalid documents' using errcode='22023'; end if;
  if (select count(distinct x->>'document_key') from jsonb_array_elements(p_documents) x) <> jsonb_array_length(p_documents) then
    raise exception 'Duplicate documents' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_documents) order by value->>'document_key' loop
    if e->>'document_key' not in ('alarm-runtime','alarm-delivery','alarm-events','dispatch-queue',
      'dispatch-executions','push-gateway-state','device-profile','app-state') then
      raise exception 'Forbidden document' using errcode='42501'; end if;
    -- Token invalidation may update device information, never a user's trip or preferences.
    if e->>'document_key'='app-state' and (e->'payload')-'device' is distinct from
      (select payload-'device' from public.smart_metro_documents where user_id=j.user_id and document_key='app-state') then
      raise exception 'Forbidden settings change' using errcode='42501'; end if;
    if e->>'expected_revision' is null or (e->>'expected_revision')::bigint<0 then
      raise exception 'Invalid revision' using errcode='22023'; end if;
    if (e->>'expected_revision')::bigint=0 then
      insert into public.smart_metro_documents(user_id,document_key,payload)
        values(j.user_id,e->>'document_key',e->'payload') returning * into saved;
    else
      update public.smart_metro_documents set payload=e->'payload',revision=revision+1,updated_at=now()
        where user_id=j.user_id and document_key=e->>'document_key' and revision=(e->>'expected_revision')::bigint returning * into saved;
      if not found then raise exception 'Document changed' using errcode='PT409'; end if;
    end if;
    result := result || jsonb_build_array(jsonb_build_object('document_key',saved.document_key,'payload',saved.payload,'revision',saved.revision));
  end loop;
  update smart_metro_private.alarm_jobs set checkpointed=true,
    completed_at=case when p_finish then now() else completed_at end,
    last_status=case when p_finish then 'completed' else 'processing' end,
    expires_at=case when p_finish then now() else expires_at end where user_id=j.user_id;
  return result;
end; $$;
revoke all on function public.commit_smart_metro_alarm_job(uuid,text,jsonb,boolean) from public,authenticated;
grant execute on function public.commit_smart_metro_alarm_job(uuid,text,jsonb,boolean) to anon;
commit;
