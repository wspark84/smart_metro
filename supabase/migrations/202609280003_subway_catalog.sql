begin;
alter table smart_metro_private.catalog_scopes drop constraint catalog_scopes_spec_check;
alter table smart_metro_private.catalog_scopes drop constraint catalog_scopes_spec_check1;
alter table smart_metro_private.catalog_scopes add constraint catalog_scopes_spec_check check(spec->>'service' in ('stops','routes','subway'));
alter table smart_metro_private.catalog_scopes add constraint catalog_scopes_spec_check1 check(
 (spec->>'service'='stops' and spec->>'operation' in ('getCtyCodeList','getSttnNoList')) or
 (spec->>'service'='routes' and spec->>'operation' in ('getCtyCodeList','getRouteNoList','getRouteInfoIem','getRouteAcctoThrghSttnList')) or
 (spec->>'service'='subway' and spec->>'operation' in ('GetKwrdFndSubwaySttnList','GetSubwaySttnAcctoSchdulList')));
-- Existing single-page queue, capability restrictions, daily quotas and refresh policy apply.
insert into smart_metro_private.catalog_scopes(spec,next_at)
 values('{"service":"subway","operation":"GetKwrdFndSubwaySttnList","params":{}}',now()-interval '1 day') on conflict do nothing;
commit;
