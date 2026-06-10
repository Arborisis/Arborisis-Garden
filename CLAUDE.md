# Arborisis Garden — CLAUDE.md

For the current feature's detailed design, see:
**[specs/001-multi-hardware-ml-ui/plan.md](specs/001-multi-hardware-ml-ui/plan.md)**

---

## Project Overview

**Arborisis Garden** is a single-user household IoT + ML + PWA system for monitoring houseplants. It combines:
- **Two Raspberry Pi Pico WH** microcontrollers (environmental sensors + bioelectric measurement)
- **Next.js 16 PWA** (App Router, React 19) deployed on Railway
- **PostgreSQL** database via Prisma 5
- **Custom ML pipeline** (gradient descent in TypeScript — no TensorFlow)
- **LLM-driven insights** via OpenRouter (claude-opus-4.8 / claude-sonnet-4.6 / claude-haiku-4.5)
- **French-first UI** — all user-facing text, AI prompts, and error messages are in French

**Scale**: Single user, <20 plants, <5 IoT devices.

---

## Repository Layout

```
app/                    # Next.js App Router (pages, API routes, components)
  api/                  # 26 API route handlers
  components/           # React UI components (PWA panels)
lib/                    # Shared TypeScript server logic
  ml/                   # ML pipeline (features, model, trainer, scoring, dataset)
  bioelectric/          # Bioelectric signal analysis (analysis, coupling, adaptive model)
  agentic/              # LLM agent orchestration (orchestrator, tools, prompts, memory)
firmware/               # MicroPython for environmental Pico (v0.2.0)
firmware-bio/           # MicroPython for bioelectric Pico
prisma/                 # schema.prisma + migrations
specs/                  # Feature specs, plans, API contracts, data models
  001-multi-hardware-ml-ui/
models/                 # ONNX disease classifier (git-ignored *.onnx files)
scripts/                # Deployment helpers (start.mjs, init-db.mjs, model upload)
tests/                  # Backend smoke tests (tests/backend-smoke.ts)
public/                 # PWA manifest, service worker, icons
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), React 19, Lucide icons |
| Backend | Next.js API routes, TypeScript 5, Node.js 22 |
| Database | PostgreSQL 15+ (Railway), Prisma 5 ORM |
| ML | Custom gradient-descent trainer (TypeScript), ONNX inference (`onnxruntime-node`) |
| LLM | OpenRouter — `claude-opus-4.8` (agent/vision), `claude-sonnet-4.6` (insights), `claude-haiku-4.5` (compaction) |
| Storage | Railway Object Storage (S3-compatible), `@aws-sdk/client-s3` |
| Auth | `bcryptjs` (device token hashing) — no user auth, single-user assumption |
| Validation | Zod 3 (all API boundaries) |
| Push | W3C Web Push + VAPID (`web-push` v3.6.7) |
| Firmware | MicroPython 1.23 (Raspberry Pi Pico WH) |
| Deployment | Railway (Docker multi-stage), `railway.json` config |

---

## Development Workflows

### Local Setup

```bash
# Install dependencies
npm install

# Set up environment (copy and fill in values)
cp .env.example .env

# Push schema to local Postgres (no migration files needed for local dev)
npm run db:push

# Start dev server (Turbopack)
npm run dev
```

### Essential Commands

```bash
npm run dev              # Dev server on port 3000
npm run build            # prisma generate + next build
npm start                # Run migrations + start production server
npm run test             # Backend smoke tests (tsx tests/backend-smoke.ts)
npm run lint             # ESLint

npm run db:push          # Sync schema to DB without migration files (local dev)
npm run prisma:migrate   # Create a named migration (for production schema changes)
npm run prisma:studio    # Visual DB browser
```

### Quality Gates (must pass before merging)

```bash
npm run lint             # ESLint (zero warnings on new code)
npm run build            # Full type-checked production build
npx tsc --noEmit         # Type-check without emitting (catches DOM/Node conflicts)
npm run test             # Backend smoke tests
npm audit --audit-level=high  # No high/critical vulnerabilities
npx prisma validate      # Schema validity
```

> `next.config.ts` sets `typescript.ignoreBuildErrors: true` — this is intentional to avoid DOM/web-push type conflicts on Railway. **Always run `npx tsc --noEmit` separately.**

### Database Changes

- **Local dev**: use `npm run db:push` (schema-first, no migration files)
- **Production**: use `npm run prisma:migrate` to create a timestamped migration; `npm start` runs `prisma migrate deploy` automatically on Railway

---

## Architecture Principles (Constitution)

Six non-negotiable principles from `specs/001-multi-hardware-ml-ui/plan.md`:

1. **Multi-Plant, Multi-Device** — Device/Plant schema must support pairing codes, per-plant calibration, and multiple simultaneous devices
2. **Production-Grade Security** — Per-device bcrypt token (`X-Device-Token` header), VAPID keys in env vars, no secrets in repo
3. **ML Intelligence** — Predictions must return `healthScore + stressLevel + confidenceScore + wateringUrgencyHours`; 4-signal fusion; online training with `MLModelVersion` rollback
4. **Premium UX** — Responsive PWA panels; design tokens via CSS custom properties; French language throughout
5. **IoT Reliability** — Telemetry endpoint idempotent by `(deviceSerial, recordedAt)`; Pico buffers 60 readings offline; sensor bounds validated on ingest
6. **Observability** — Structured logs on ingest + ML inference; `/api/health`; push alerts on critical/high severity

---

## Key Conventions

### TypeScript

- **Strict mode** is on (`tsconfig.json`)
- Use Zod for all runtime validation at system boundaries (API routes, telemetry ingest)
- `lib/schemas.ts` contains shared Zod schemas — add new ones there, not inline in routes
- Native `fetch` for HTTP calls (no axios)
- `serverExternalPackages`: `onnxruntime-node` and `sharp` are excluded from bundling — never import them in client components

### API Routes

- All routes live in `app/api/` following Next.js App Router conventions
- Device authentication: `X-Device-Token` header, validated against bcrypt hash in DB
- Response format: return typed JSON; use `NextResponse.json()` with appropriate HTTP status
- Performance targets: `POST /api/telemetry` < 200 ms, `GET /api/ml/predict` < 500 ms
- Full API contracts in `specs/001-multi-hardware-ml-ui/contracts/api.md`

### Database (Prisma)

- Singleton client in `lib/prisma.ts` — always import from there
- Max 10 DB connections (Railway constraint)
- Key composite unique indexes: `(deviceSerial, recordedAt)` on readings, `(plantId, recordedAt)` on bio readings
- Do not use `prisma.$executeRaw` without a clear reason — prefer typed ORM operations

### ML Pipeline (`lib/ml/`)

```
extractFeatures()    →  MLFeatures   (lib/ml/features.ts)
       ↓
predict(features, weights)  →  MLPrediction  (lib/ml/model.ts)
       ↓
4-signal scoring:
  computeSensorScore()       (soil moisture, temperature, humidity, light)
  computeWeatherRisk()       (forecast, ET₀ evapotranspiration)
  computeVisualScore()       (ONNX disease classifier, color anomaly)
  computeLLMConsensus()      (cached insights, agent observations)
```

- **No TensorFlow/PyTorch** — all training is gradient descent in TypeScript (`lib/ml/trainer.ts`)
- Online learning (`lib/ml/online.ts`) with recency weighting
- `MLModelVersion` snapshots weights; always keep an active version and allow rollback
- ONNX disease classifier is optional — system degrades gracefully without it
- ONNX `.onnx` files are git-ignored; load from Railway Object Storage in production

### Bioelectric Subsystem (`lib/bioelectric/`)

- 2nd Pico samples at configurable Hz (default 128 Hz), sends per-window stats
- Server computes: RMS, frequency bands, spike count, activity index
- `lib/bioelectric/analysis.ts` detects environment events (watering, light, temp changes)
- `lib/bioelectric/coupling.ts` correlates bio signals with plant care events
- All thresholds configurable via env vars (see `lib/bioelectric/config.ts`)

### LLM / Agentic (`lib/agentic/`)

- OpenRouter is the sole LLM provider — key in `OPENROUTER_API_KEY`
- Model assignment by task:
  - Agent/chat/calibration: `OPENROUTER_MODEL` (default `anthropic/claude-opus-4.8`)
  - Photo analysis: `OPENROUTER_VISION_MODEL`
  - Dashboard insights: `OPENROUTER_INSIGHTS_MODEL` (default `anthropic/claude-sonnet-4.6`)
  - Conversation compaction: `OPENROUTER_COMPACT_MODEL` (default `anthropic/claude-haiku-4.5`)
- Insights are cached for 4 hours in the `Memory` table (keyed by plant + weather fingerprint)
- All system prompts are in French (`lib/agentic/prompts.ts`)
- Conversation compaction via haiku prevents context overflow (`lib/agentic/memory.ts`)

### Firmware (MicroPython)

- `firmware/` — Environmental Pico v0.2.0: BME280 (air temp/humidity), TSL2561 (lux), DS18x20 (soil temp), ADC (soil moisture, battery)
- `firmware-bio/` — Bioelectric Pico: raw ADC signal acquisition, per-window stats
- Polling interval: 45 s (configurable in `firmware/config.py`)
- Device authenticates with `X-Device-Token` header (bcrypt token stored in `firmware/config.py`)
- Offline buffering: up to 60 readings in RAM, flushes oldest-first on reconnect
- Hardware watchdog at ~8 s

### Frontend / PWA

- Main shell: `app/components/garden-app.tsx` — tabbed UI (Overview, Photos, Calendar, Weather, Insights, Chat, ML, Devices)
- Design tokens via CSS custom properties in `app/globals.css` (theme color `#06110d`)
- PWA manifest in `public/manifest.json`, service worker in `public/sw.js`
- Web Push: `app/components/service-worker-register.tsx` handles VAPID subscription
- Language: `<html lang="fr">` — UI is French

---

## Environment Variables

Key variables (see `.env.example` for full list with descriptions):

```bash
DATABASE_URL=postgresql://...             # PostgreSQL connection string
DEVICE_INGEST_TOKEN=...                   # Plaintext token (bcrypt-hashed on first run)
OPENROUTER_API_KEY=sk-or-...              # Required for LLM features
OPENROUTER_MODEL=anthropic/claude-opus-4.8
OPENROUTER_INSIGHTS_MODEL=anthropic/claude-sonnet-4.6
OPENROUTER_COMPACT_MODEL=anthropic/claude-haiku-4.5
OPENROUTER_REASONING_EFFORT=high          # low|medium|high|off
STORAGE_ENDPOINT=https://...              # Railway Object Storage (S3-compatible)
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET=...
VAPID_PUBLIC_KEY=...                      # Generate: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=...
VAPID_MAILTO=mailto:you@example.com
ML_AUTO_TRAIN_THRESHOLD=10                # New samples before auto-retrain
```

Bioelectric and disease classifier variables are all optional with sensible defaults.

---

## Testing

**Backend smoke tests** (`tests/backend-smoke.ts`):

```bash
npm run test
```

Covers: telemetry schema validation, alert rule evaluation, LLM insights parsing, bioelectric analysis, ML feature extraction + training, online learning, dataset export (JSONL/CSV/gzip/SHA256).

**No E2E or unit tests** exist yet. Manual browser testing is required for PWA features.

---

## Deployment (Railway)

```bash
# Production build (runs automatically on Railway)
npm run build   # prisma generate + next build

# Production start (runs automatically on Railway)
npm start       # prisma migrate deploy → next start -p $PORT
```

- Health check: `GET /api/health` (120 s timeout)
- Dockerfile: 3-stage build (`deps` → `builder` → `runner`), base `node:22-slim`
- Auto-restart on failure (max 3 retries)
- ONNX models: upload via `scripts/upload-model-to-bucket.ts` → Railway Object Storage

---

## Spec Kit Integration

This project uses **Spec Kit** for design-driven development:

```
specs/001-multi-hardware-ml-ui/
├── spec.md          # Feature requirements (R1–R8)
├── plan.md          # Implementation plan + constitution checks
├── data-model.md    # Entity definitions and Prisma schema walkthrough
├── research.md      # Technology decision justifications
├── quickstart.md    # Developer setup guide
├── contracts/api.md # All 26 API endpoint contracts
└── tasks.md         # Dependency-ordered task list
```

Use `/speckit-*` skills when working within the Spec Kit workflow.

---

## Notes for AI Assistants

- **Always run `npx tsc --noEmit`** when making TypeScript changes — the build silences type errors intentionally
- **`lib/prisma.ts`** is the singleton — never instantiate `PrismaClient` elsewhere
- **French language** — keep all user-facing strings, comments in user-visible output, and LLM prompts in French
- **No auth layer for users** — this is single-user; don't add auth middleware unless asked
- **ONNX files are excluded from git** — don't try to commit `.onnx` files; they belong in Railway Object Storage
- **`serverExternalPackages`** — `onnxruntime-node` and `sharp` must never be imported in client-side code
- **Bioelectric thresholds** are configurable in env vars via `lib/bioelectric/config.ts` — don't hardcode them
- **Constitution §I** (Multi-Plant, Multi-Device) has a known open item: device pairing flow (PairingCode model + `/api/devices/pair`) must be complete before the `001-multi-hardware-ml-ui` branch merges
