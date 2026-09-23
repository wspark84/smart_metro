# Background departure alarms

The confirmed home form enables departure planning for the selected route. Reminder stages are 20, 10, 5 and 3 minutes before leaving home, including the user's walk to the first stop. One-minute and zero-minute alerts are deliberately excluded.

## Deployment

1. Apply `202609230001_alarm_worker.sql`. It adds restricted capability RPCs and private tables; it does not change existing document RLS policies. The worker is disabled initially.
2. Deploy the Node server, including `/api/alarm-worker`.
3. Apply `202609230002_alarm_schedule.sql` to install the one-minute Supabase Cron job. It still does no work while disabled.
4. Enable with `update smart_metro_private.alarm_control set enabled=true where singleton;`.
5. Check `cron.job`, `cron.job_run_details` and the private jobs' status timestamps. Never select/log job tokens or pg_net request bodies.

To stop background processing, set the control flag to false and deactivate the named cron job. Foreground processing resumes when the flag is false. No rollback should remove user documents.

## Security and delivery

- PostgreSQL chooses users from saved application settings. The incoming HTTP request cannot select a user.
- Each job carries a 64-hex random capability, stored only as SHA-256 in the private job table. It expires after two minutes and can be claimed once.
- A job can read only its user's application documents. Writes are restricted to alarm/runtime/dispatch documents and device-token invalidation, not trip settings.
- Existing document revisions remain enforced. Outbox and consumed stages are checkpointed before external push delivery.
- Foreground requests become reads when the scheduler is enabled, avoiding duplicate foreground/background execution.
- Estimates remain labeled estimates. A recent anchor may be retained for 30 minutes; journey validation expires after 15 minutes unless refreshed successfully.
- Supabase schedules up to 20 eligible accounts per minute, oldest scheduled first. This is an initial capacity limit, not a general-scale scheduler; increase capacity/shard and load-test before broader launch.
- Minute-level scheduling and network/provider latency mean exact second-level delivery is not guaranteed.
- Physical-device push permission, valid subscription/token, installed-app requirements, and real receipt must be verified separately. A passing server job is not proof of a received phone notification.

## Tests

`npm test` includes PostgreSQL capability ownership, wrong/replayed/expired tokens, forbidden settings writes, stale revisions, outbox checkpoint ordering, source updates, reminder deduplication, snooze and retry cancellation.
