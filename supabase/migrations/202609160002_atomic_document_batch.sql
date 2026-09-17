begin;

-- Lock each user's batch before checking revisions. All writes succeed or none
-- do; this keeps route/app-state and alarm runtime documents in sync.
create or replace function public.save_smart_metro_documents(p_documents jsonb)
returns setof public.smart_metro_documents
language plpgsql security invoker set search_path = ''
as $$
declare
  entry jsonb;
  owner uuid := auth.uid();
begin
  if owner is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_documents) is distinct from 'array' then
    raise exception 'Documents must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_documents) < 1 or jsonb_array_length(p_documents) > 11 then
    raise exception 'Invalid document count' using errcode = '22023';
  end if;
  if (select count(distinct x->>'document_key') from jsonb_array_elements(p_documents) x)
     <> jsonb_array_length(p_documents) then
    raise exception 'Duplicate document keys' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text, 0));
  for entry in select value from jsonb_array_elements(p_documents) order by value->>'document_key'
  loop
    if entry->>'expected_revision' is null then
      raise exception 'Revision required' using errcode = '22023';
    end if;
    return next public.save_smart_metro_document(
      entry->>'document_key', entry->'payload', (entry->>'expected_revision')::bigint
    );
  end loop;
end;
$$;

revoke all on function public.save_smart_metro_documents(jsonb) from public, anon;
grant execute on function public.save_smart_metro_documents(jsonb) to authenticated;
commit;
