# BusWakeUp Deployment Guide

> Vercel deployment warning (2026-09-09): this repository still writes account and alarm data into local `data/` files and runs a 15-second in-process timer. The existing Vercel function packaging serves the application but does not provide durable storage or a continuously running alarm worker. Do not treat a successful Vercel page load as production readiness. Use a persistent single-instance pilot server as described below, or migrate storage and scheduling before production deployment. See `REVIEW_REPORT_2026-09-09.md`.

This configuration runs the current **single-process, file-backed prototype** in a Docker container. It is appropriate for a controlled pilot and staging environment. It is not a multi-server production architecture: one Docker volume holds all account, alarm, and delivery data, so do not start multiple replicas against separate volumes.

## 1. Prepare the server

1. Install Docker Engine or Docker Desktop with Docker Compose v2.
2. Put this repository on a server that has a stable public HTTPS address.
3. Create the environment file without placing it in Git:

```powershell
Copy-Item .env.example .env
```

4. Edit `.env` and set at least `APP_BASE_URL` to the exact public HTTPS URL. Add the official Seoul, Gyeonggi, TAGO, Kakao, and holiday keys needed for the features being tested.
5. Keep `PUSH_GATEWAY_MODE=preview` until the physical Android and iPhone test checklist is complete. To deliver FCM messages, set `FCM_PROJECT_ID` and a single-line `FCM_SERVICE_ACCOUNT_JSON` value. Do not use a Windows or macOS `FCM_SERVICE_ACCOUNT_FILE` path inside Docker: that path does not exist in the container.

## 2. Start and inspect

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --follow buswakeup
```

Docker reports the container healthy only when its internal `GET /api/healthz` liveness request succeeds. That endpoint intentionally avoids user data, alarm scheduling, FCM authentication, and upstream provider calls. Confirm mobile readiness separately from the actual public URL before connecting a phone.

```powershell
Invoke-WebRequest https://buswakeup.example.com/api/mobile/health
```

## 3. HTTPS and network boundary

The container intentionally exposes plain HTTP on port `4173`. Put it behind a managed HTTPS load balancer, Caddy, Nginx, or a platform proxy that terminates TLS. Use the public HTTPS URL in `APP_BASE_URL`; this is required for secure browser sessions and Apple sign-in redirect rules.

Do not expose the Docker port directly to the internet without a reverse proxy, firewall rules, logging, backups, and an incident response plan. Restrict server administration access and never place `.env` or the Docker data volume in a public file share.

## 4. Persist and back up data

The Compose service mounts the named volume `buswakeup-data` at `/app/data`. It is the only persistent state in this prototype. Rebuilding the image preserves that volume; removing the volume deletes all local accounts, schedules, device-token state, alarm records, and ETA history.

Back up the volume before an upgrade and test the restore process in a separate staging environment. Keep exactly one active application container until storage is migrated to a transactional database and distributed scheduler.

## 5. Update and rollback

Before an update, back up the data volume and run the automated checks in this repository. Then rebuild the container:

```powershell
docker compose up -d --build
docker compose logs --follow buswakeup
```

An image rollback does not roll back file-backed data. If an update changes persisted data incorrectly, restore the tested backup as well as the earlier image.

## Launch blockers outside this repository

- A real public domain, HTTPS certificate, firewall, and server backup process.
- Official production API credentials for Seoul, Gyeonggi, TAGO, Kakao, holidays, and Firebase as applicable.
- Firebase project setup, Android signing, APNs key/certificate setup, and a physical Android plus iPhone push test.
- macOS/Xcode with an Apple Developer Team to archive and sign the iPhone app.
- Production database, encrypted secret manager, monitoring, alerting, and a multi-instance-safe alarm scheduler before scaling beyond a controlled pilot.
