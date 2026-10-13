-- Account deletion keeps a minimal, de-identified purchase ledger.
-- 전자상거래법: 대금결제·공급 기록 5년 보존. The ledger holds no user id, e-mail,
-- address or raw purchase token: only hashes that match Google Play's
-- obfuscatedExternalAccountId (sha256("inochi:" || user id)) and the token hash.
begin;
create schema if not exists smart_metro_private;
create table if not exists smart_metro_private.inochi_purchase_ledger (
  token_hash text primary key,
  billing_account_hash text not null,
  product_id text not null,
  state text not null,
  expires_at timestamptz not null,
  last_verified_at timestamptz not null,
  account_deleted_at timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '5 years'
);
alter table smart_metro_private.inochi_purchase_ledger enable row level security;
revoke all on smart_metro_private.inochi_purchase_ledger from public, anon, authenticated;

-- ON DELETE CASCADE from auth.users fires this row trigger for every purchase row.
create or replace function smart_metro_private.inochi_archive_purchase()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into smart_metro_private.inochi_purchase_ledger
    (token_hash, billing_account_hash, product_id, state, expires_at, last_verified_at)
  values (old.token_hash, encode(sha256(convert_to('inochi:' || old.user_id::text, 'UTF8')), 'hex'),
    old.product_id, old.state, old.expires_at, old.verified_at)
  on conflict (token_hash) do update set state = excluded.state, expires_at = excluded.expires_at,
    last_verified_at = excluded.last_verified_at, account_deleted_at = now(),
    retain_until = now() + interval '5 years';
  return old;
end; $$;
revoke all on function smart_metro_private.inochi_archive_purchase() from public, anon, authenticated;

drop trigger if exists inochi_archive_purchase_before_delete on public.inochi_play_subscriptions;
create trigger inochi_archive_purchase_before_delete
  before delete on public.inochi_play_subscriptions
  for each row execute function smart_metro_private.inochi_archive_purchase();

-- Destroy ledger rows once the legal retention period has passed.
create or replace function smart_metro_private.inochi_purge_purchase_ledger()
returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from smart_metro_private.inochi_purchase_ledger where retain_until < now() returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function smart_metro_private.inochi_purge_purchase_ledger() from public, anon, authenticated;
commit;

-- Run once in Supabase (pg_cron is already enabled by the alarm schedule migration):
-- select cron.schedule('inochi-purge-purchase-ledger', '17 3 * * *', 'select smart_metro_private.inochi_purge_purchase_ledger();');
