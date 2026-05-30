<!--
SYNC IMPACT REPORT
==================
Version change: UNVERSIONED (template) → 1.0.0
Modified principles: n/a (initial fill — all tokens replaced)
Added sections:
  - Core Principles (6 principles)
  - Production & Infrastructure Requirements
  - Development Workflow
  - Governance
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ constitution check section applies
  - .specify/templates/spec-template.md ✅ requirements structure aligns
  - .specify/templates/tasks-template.md ✅ task phases align
Deferred TODOs:
  - RATIFICATION_DATE set to 2026-05-30 (today — first ratification)
  - No placeholder tokens left unexplained
-->

# Arborisis Garden Constitution

## Core Principles

### I. Multi-Plant, Multi-Device Architecture (NON-NEGOTIABLE)

Every data entity in the system MUST be scoped to a Plant, and every Plant MUST
be optionally linkable to a Device. A single user account MUST support an
unbounded number of Plants and Devices.

- One Device MAY serve multiple Plants (shared hardware); one Plant MAY receive
  telemetry from exactly one active Device at a time.
- Device pairing MUST be initiated exclusively via a time-limited pairing code
  entered in the web interface — no SSH, no config-file patching, no QR-only
  workarounds.
- Pairing codes MUST be 6–8 alphanumeric characters, expire after 15 minutes,
  and be single-use. The firmware fetches the resolved token after code
  validation; the server MUST hash and store only the token, never the raw
  pairing code.
- Unpairing a Device MUST be possible from the web UI without data loss; all
  historical readings MUST remain queryable under the original Plant.

**Rationale**: The hardware fleet grows independently of the plant catalogue;
treating them as a fixed 1-to-1 mapping blocks multi-room and multi-user
scenarios that are central to the product vision.

### II. Production-Grade Security

All API surface that writes data MUST be authenticated. Authentication proofs
MUST be validated server-side on every request — no client-side trust.

- Device ingest endpoints (`/api/telemetry`, `/api/devices/*`) MUST require a
  per-device token validated via constant-time `bcrypt` comparison.
- Pairing-code endpoints MUST be rate-limited (max 5 attempts per IP per minute)
  and MUST NOT reveal whether a code exists on failure.
- Web Push VAPID keys, database credentials, and API secrets MUST NEVER be
  committed to the repository; they MUST live exclusively in environment
  variables or Railway secret references.
- All HTTP responses MUST include `Content-Security-Policy`, `X-Frame-Options`,
  and `Strict-Transport-Security` headers in production.
- Dependency audit (`npm audit --audit-level=high`) MUST pass with zero high or
  critical findings before any production deploy.

**Rationale**: IoT surfaces are a frequent attack vector; a single unprotected
ingest endpoint can corrupt an entire fleet's data or exfiltrate sensor history.

### III. State-of-the-Art ML Intelligence

The health-scoring pipeline MUST fuse at minimum four independent signal sources:
raw sensor telemetry, photo-based visual analysis (via multimodal LLM), weather
forecast risk, and LLM-consensus reasoning. No single-signal shortcut is
acceptable for the primary health score.

- The model MUST support continuous online improvement: every user-confirmed
  watering event, photo analysis, or manual health override MUST generate an
  `MLTrainingSample` row and MUST trigger a weight-retraining check.
- A versioned `MLModelVersion` record MUST be persisted for every trained set of
  weights; rollback to any prior version MUST be achievable in one API call.
- Model inference MUST return a structured `MLPrediction` with `healthScore`
  (0–100), `stressLevel` enum, `confidenceScore` (0–1), and a
  `wateringUrgencyDays` estimate.
- Prediction confidence MUST be surfaced to the user whenever it drops below 0.4
  (low-data warning).
- The ML pipeline MUST be stateless at inference time — weights are loaded from
  the active `MLModelVersion`; no in-process mutable state is permitted.

**Rationale**: A precision-agriculture companion that degrades to "just a
moisture chart" when the ML is vague or opaque is indistinguishable from a $5
Bluetooth sensor. The model is the product differentiator.

### IV. Premium Design System & User Experience

The frontend MUST meet the quality bar of a top-tier consumer product studio
(Vercel, Linear, Notion, Craft). This is non-negotiable — visual quality is a
first-class product requirement, not a polish step.

- A single, coherent design token system MUST govern all colours, spacing,
  typography, radii, and motion curves. Tokens MUST be defined in CSS custom
  properties or a dedicated token file; magic numbers in component stylesheets
  are forbidden.
- Every interactive element MUST have a defined focus ring, hover state, active
  state, and disabled state.
- Transitions and micro-animations MUST use the `prefers-reduced-motion` media
  query to respect accessibility preferences.
- The application MUST be fully responsive from 320 px to 2560 px without
  horizontal scroll.
- The PWA MUST achieve a Lighthouse Performance score ≥ 85 and Accessibility
  score ≥ 95 on mobile in production.
- Dashboard layout MUST convey plant health status at a glance — a user MUST be
  able to identify any plant in critical stress within 3 seconds of opening the
  app, without reading numbers.

**Rationale**: The hardware companion angle only works if the software inspires
trust and delight. A generic data-table UI actively undermines the premium
positioning of a precision plant care device.

### V. IoT Reliability & Telemetry Integrity

The firmware-to-cloud data path MUST be designed for hostile network conditions
(intermittent Wi-Fi, power cycles, firmware crashes).

- The Pico firmware MUST retry failed telemetry POST requests with exponential
  back-off (max 3 retries, 30 s cap) before discarding the reading.
- The server ingest endpoint MUST be idempotent: duplicate readings identified
  by `(deviceSerial, recordedAt)` MUST be silently deduplicated, never rejected
  with a 4xx error.
- Sensor values MUST be validated server-side against physiological bounds
  (e.g., `soilTempC` outside −10 °C … +60 °C triggers a `SENSOR_FAULT` alert,
  not a database write).
- The web app MUST display the last-seen timestamp and signal quality (`wifiRssi`)
  for every paired device, and MUST surface a "device offline" warning when no
  reading has arrived within the expected polling interval × 3.
- Database writes for readings MUST use a connection pool with a maximum of 10
  connections to prevent Railway Postgres from being exhausted under burst load.

**Rationale**: A plant care app that silently loses sensor data, or crashes when
the Pico reboots mid-POST, will produce wrong health scores and misplaced
watering reminders — eroding user trust faster than any design flaw.

### VI. Observability & Production Operations

Every production-impacting event MUST be traceable without SSH access to the
server.

- Structured JSON logs MUST be emitted for: ingest requests (device serial,
  reading count, latency), ML inference (model version, health score, confidence),
  push notification delivery (subscription count, failures), and all 4xx/5xx API
  responses.
- Alerts MUST be emitted to the `Alert` table AND as Web Push notifications when
  `severity` is `critical` or `high`, provided the user has granted push
  permission.
- The `/api/health` endpoint MUST respond with `200 OK` and a JSON body
  containing database reachability, ML model version, and last telemetry
  timestamp. It MUST NOT require authentication.
- Railway deployment MUST use a `Dockerfile` with multi-stage build; the
  production image MUST NOT include dev dependencies.
- Database migrations MUST be applied via `prisma migrate deploy` in the Railway
  release command, never via `db push` in production.

**Rationale**: A single Postgres connection leak or silent push-notification
failure can degrade the experience for every user. Observable systems catch these
issues before users report them.

## Production & Infrastructure Requirements

### Deployment Target

- **Primary**: Railway (Postgres + Node.js service via Dockerfile)
- **CDN / Static**: Next.js built artefacts served via Railway; no separate CDN
  is required until sustained traffic exceeds 1 000 MAU.
- **Object Storage**: Plant photos MUST be stored in Railway Object Storage (or
  an S3-compatible bucket). Photos MUST NOT be stored as database BLOBs.
- **Environment parity**: `development`, `staging`, and `production` MUST each
  have their own DATABASE_URL. Staging MUST mirror production schema exactly.

### Performance Baselines (production, p95)

| Endpoint | Target |
|---|---|
| `POST /api/telemetry` | < 200 ms |
| `GET /api/plants` | < 300 ms |
| `POST /api/ml/predict` | < 500 ms |
| `GET /api/chat` (first token) | < 1 500 ms |
| Full-page (PWA shell, 4G) | < 3 s |

### Data Retention

- Raw `Reading` rows: retained indefinitely (time-series value).
- `MLTrainingSample` rows: retained for 2 years; older samples MUST be archived
  before deletion.
- `ChatMessage` rows: retained for 1 year; summarised into `Plant.memorySummary`
  by the agentic pipeline before expiry.

## Development Workflow

### Branch Strategy

- `main` is always deployable to production.
- Feature work MUST happen on `speckit`-managed branches following the
  `###-feature-name` naming convention.
- Direct commits to `main` are forbidden; all merges require at least one
  self-review pass and a passing CI run.

### Quality Gates (pre-merge)

1. `npm run lint` — zero errors.
2. `npx tsc --noEmit` — zero type errors.
3. `npm audit --audit-level=high` — zero high/critical findings.
4. Prisma schema validates (`npx prisma validate`).
5. `npm run build` — successful production build.

No gate may be skipped without a documented exception in the PR description.

### Firmware Versioning

- Firmware version MUST follow `MAJOR.MINOR.PATCH` (semver).
- A breaking change to the telemetry payload schema (adding non-nullable fields,
  removing fields) constitutes a MAJOR bump and MUST be coordinated with a
  matching server-side migration deployed first.

## Governance

This constitution supersedes all other coding conventions, README guidance, and
verbal agreements for the Arborisis Garden project.

**Amendment procedure**:
1. Open a branch with the prefix `constitution/`.
2. Edit `.specify/memory/constitution.md` and update `CONSTITUTION_VERSION`
   following semver rules documented in this file's Sync Impact Report header.
3. Update `LAST_AMENDED_DATE` to the date of the PR merge.
4. Run the consistency propagation checklist (section 4 of the speckit-constitution skill).
5. Merge only after the change is understood and accepted by the project owner.

**Compliance review**: Every implementation plan (`/speckit-plan`) MUST include
a "Constitution Check" gate referencing the relevant principle numbers. Violations
MUST be justified in the Complexity Tracking table of the plan.

**Vague language policy**: Any principle containing "should" or "may want to"
MUST be clarified at the next amendment cycle. All non-negotiable rules use MUST;
recommendations use SHOULD with an explicit rationale.

**Version**: 1.0.0 | **Ratified**: 2026-05-30 | **Last Amended**: 2026-05-30
