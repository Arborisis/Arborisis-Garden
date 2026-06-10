# Quickstart: 001-multi-hardware-ml-ui

## Prerequisites

- Node.js ≥ 22
- PostgreSQL (or Railway Postgres service)
- Railway CLI (`npm i -g @railway/cli`) for object storage
- A Railway project with Postgres and Object Storage provisioned

## Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
DATABASE_URL=postgresql://user:password@host:5432/arborisis

# Device ingest auth
DEVICE_INGEST_TOKEN=change-me-device-token

# LLM (OpenRouter)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-opus-4.8

# Railway Object Storage (S3-compatible)
STORAGE_ENDPOINT=https://...railway.app
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET=arborisis-photos

# Web Push VAPID keys (generate once)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com

# Open-Meteo is free, no API key needed
```

### Generating VAPID keys

```bash
npx web-push generate-vapid-keys
```

Copy `publicKey` → `VAPID_PUBLIC_KEY`, `privateKey` → `VAPID_PRIVATE_KEY`.

## Database setup

```bash
npm install
npx prisma migrate deploy   # applies all migrations
# or for local dev:
npm run db:push              # push schema (no migration files)
```

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. The Pico must point to `http://<your-mac-ip>:3000/api/telemetry`.

## ML pipeline walkthrough

1. **Add a plant** and link it to a Device via the web UI.
2. **Upload a photo** (Photos tab) — this triggers LLM visual analysis and auto-collects the first `MLTrainingSample`.
3. **Collect more samples** — click "Collecter données ML" in the ML Intelligence Panel to manually trigger feature extraction.
4. **Train** — once ≥ 3 samples exist, click "Entraîner modèle". Training runs in-browser via the `/api/ml/train` endpoint and persists a new `MLModelVersion`.
5. **View prediction** — the ML panel shows the live health score with breakdown by sensor / visual / weather / LLM signals.

## Calibrating moisture sensor

In the plant settings, tap "Calibrer capteur" and follow the two-step process:

1. Insert the sensor in **dry air** → read raw ADC value → save as `moistureDryRaw`.
2. Insert the sensor in **saturated soil** → read raw ADC value → save as `moistureWetRaw`.

The app calls `POST /api/plants/calibrate` with both values.

## Web Push notifications

1. Open the app in a supported browser.
2. Click the bell icon → grant notification permission.
3. The browser subscription is stored in `PushSubscription` via `POST /api/push/subscribe`.
4. Critical/high alerts will trigger push notifications even with the tab closed.

## Firmware update (TSL2561 fix)

The 0.1.1 firmware bump in `firmware/config.py` is a patch change — no breaking schema changes. Flash the updated `firmware/` folder to the Pico WH:

```bash
# Using mpremote
mpremote cp -r firmware/. :
```

The lux readings will now correctly account for the 402 ms integration time and default 1× gain setting.

## Production deploy (Railway)

```bash
railway up
```

The `Dockerfile` multi-stage build handles `prisma generate` + `npm run build`. The release command runs `prisma migrate deploy` before starting the server.

## Quality gates (run before merging)

```bash
npm run lint
npx tsc --noEmit
npm audit --audit-level=high
npx prisma validate
npm run build
```
