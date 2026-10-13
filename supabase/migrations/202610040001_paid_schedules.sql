begin;
create table if not exists public.inochi_play_subscriptions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_token text not null,
  product_id text not null check(product_id='inochi_schedule_monthly'),
  state text not null,
  expires_at timestamptz not null,
  auto_renew boolean not null default false,
  verified_at timestamptz not null
);
create index if not exists inochi_play_subscriptions_user on public.inochi_play_subscriptions(user_id);
alter table public.inochi_play_subscriptions enable row level security;
revoke all on public.inochi_play_subscriptions from public,anon,authenticated;
grant select,insert,update on public.inochi_play_subscriptions to service_role;
create or replace function public.inochi_save_play_subscription(p_row jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.inochi_play_subscriptions(token_hash,user_id,purchase_token,product_id,state,expires_at,auto_renew,verified_at)
  values(p_row->>'token_hash',(p_row->>'user_id')::uuid,p_row->>'purchase_token',p_row->>'product_id',p_row->>'state',
    (p_row->>'expires_at')::timestamptz,(p_row->>'auto_renew')::boolean,(p_row->>'verified_at')::timestamptz)
  on conflict(token_hash) do update set state=excluded.state,expires_at=excluded.expires_at,
    auto_renew=excluded.auto_renew,verified_at=excluded.verified_at
  where inochi_play_subscriptions.user_id=excluded.user_id
    and inochi_play_subscriptions.verified_at<=excluded.verified_at;
  if not found then raise exception 'Purchase ownership or version conflict' using errcode='42501';end if;
end; $$;
revoke all on function public.inochi_save_play_subscription(jsonb) from public,anon,authenticated;
grant execute on function public.inochi_save_play_subscription(jsonb) to service_role;

-- Protect direct Supabase writes, not only the web API. Preserve existing schedules on expiration.
create or replace function public.inochi_guard_schedule_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_trips jsonb;after_trips jsonb;
begin
  if new.document_key not in ('app-state','domain-store') then return new;end if;
  after_trips=coalesce(case when new.document_key='app-state' then new.payload->'tripSchedules' else new.payload#>'{schedule,tripSchedules}' end,'[]'::jsonb);
  before_trips=case when tg_op='INSERT' then '[]'::jsonb else coalesce(case when old.document_key='app-state' then old.payload->'tripSchedules' else old.payload#>'{schedule,tripSchedules}' end,'[]'::jsonb) end;
  if after_trips<>before_trips and not exists(select 1 from public.inochi_play_subscriptions s where s.user_id=new.user_id
    and s.state in ('SUBSCRIPTION_STATE_ACTIVE','SUBSCRIPTION_STATE_IN_GRACE_PERIOD','SUBSCRIPTION_STATE_CANCELED')
    and s.expires_at>now() and s.verified_at>now()-interval '5 minutes') then
    raise exception 'Schedule subscription required' using errcode='PT402';
  end if;
  return new;
end; $$;
revoke all on function public.inochi_guard_schedule_write() from public,anon,authenticated;
drop trigger if exists inochi_paid_schedule_write on public.smart_metro_documents;
create trigger inochi_paid_schedule_write before insert or update on public.smart_metro_documents
for each row execute function public.inochi_guard_schedule_write();
commit;
