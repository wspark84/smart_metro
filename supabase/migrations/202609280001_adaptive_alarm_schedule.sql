-- Run after deploying adaptive nextRefreshAt gating in the application server.
-- Existing capability scope, leases and per-account authorization are unchanged.
select cron.alter_job(jobid, schedule := '30 seconds')
from cron.job where jobname = 'smart-metro-alarm-worker';
