# Tasks: Multi-Hardware ML Intelligence & UI Expansion

**Input**: Design documents from `specs/001-multi-hardware-ml-ui/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/api.md ✅, quickstart.md ✅

**Tests**: No test tasks — testing strategy is manual + `npm run build` / `npx tsc --noEmit` / `npm run lint` / `npm audit` (see quickstart.md quality gates).

**Organization**: Tasks are grouped by user story (R1–R8) to enable independent implementation and verification of each requirement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which requirement this task belongs to (US1=R1, US2=R2, …)
- All tasks include exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies and configure environment. No existing code changes — safe starting point.

- [X] T001 Install new npm dependencies: `web-push`, `@aws-sdk/client-s3` in package.json (run `npm install web-push @aws-sdk/client-s3 @types/web-push`)
- [X] T002 [P] Add new env var entries to `.env.example`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`
- [X] T003 [P] Bump firmware version `0.1.0` → `0.1.1` in `firmware/config.py`

**Checkpoint**: Dependencies installed, env vars documented, firmware version correct.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema changes and shared types that MUST be complete before any user story implementation can begin.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add `PairingCode`, `PlantPhoto`, `CalendarEvent`, `PushSubscription`, `MLTrainingSample`, `MLModelVersion` models and `moistureDryRaw`/`moistureWetRaw` fields on `Plant` to `prisma/schema.prisma`; run `npx prisma migrate dev --name 001-multi-hardware-ml-ui` to generate migration file in `prisma/migrations/`
- [X] T005 [P] Define shared ML types `MLFeatures`, `MLPrediction`, `ModelWeights`, `TrainingSample`, `TrainingResult` in `lib/ml/types.ts`
- [X] T006 [P] Fix TSL2561 lux scaling in `firmware/drivers/tsl2561.py`: expose `self.integration_ms = 402` and `self.gain_16x = False` as instance vars; apply `scale = 402 / integration_ms × (1 if gain_16x else 16)` to raw channel counts before the datasheet lux formula (TSL2561 AN §3.2)

**Checkpoint**: `npx prisma validate` passes, `lib/ml/types.ts` exports all ML types, firmware driver corrected.

---

## Phase 3: US1 — Multi-Hardware Device Model & Pairing (Priority: P1) ⚠️ CONSTITUTION §I — REQUIRED BEFORE MERGE

**Goal**: Full device pairing flow — 6-8 char code UI, expiry, single-use validation, rate limiting, hashed token storage; moisture calibration endpoint; device offline warning. This is a non-negotiable Constitution §I requirement.

**Independent Test**: Generate a pairing code via the UI → use `/api/devices/pair/resolve` with that code → confirm Device gains `tokenHash` and code is marked used. Attempt re-use → 400. Wait for expiry → 400. Submit invalid code 5× → rate-limited. Calibrate moisture sensor via UI → check Plant `moistureDryRaw`/`moistureWetRaw` updated.

- [X] T007 [US1] Implement `rawToPercent(raw, dryRaw, wetRaw): number` (clamped 0–100) in `lib/calibration.ts`
- [X] T008 [US1] Implement `POST /api/plants/calibrate` route in `app/api/plants/calibrate/route.ts`: validate `{ plantId, moistureDryRaw, moistureWetRaw }` with Zod, update Plant via Prisma, return updated calibration fields
- [X] T009 [US1] Implement rate-limiting helper `checkRateLimit(ip, key, maxAttempts, windowMs): boolean` in `lib/rate-limit.ts` using an in-memory sliding window (single-user, < 5 devices — no Redis needed); track failed pairing resolve attempts per IP
- [X] T010 [US1] Implement `POST /api/devices/pair` route in `app/api/devices/pair/route.ts`: generate a cryptographically random 6–8 alphanumeric code (use `crypto.randomBytes`), persist `PairingCode` row with `expiresAt = now + 15 min`, return `{ code, expiresAt }`; raw code is NOT stored beyond the hashed form — store plaintext only until `usedAt` is set
- [X] T011 [US1] Implement `POST /api/devices/pair/resolve` route in `app/api/devices/pair/resolve/route.ts`: apply rate limit (max 5 failed attempts per IP per minute via `lib/rate-limit.ts`); validate code (not expired, `usedAt` null); generate device token with `crypto.randomBytes(32).toString('hex')`; bcrypt-hash → `Device.tokenHash`; mark `PairingCode.usedAt = now`; failure responses MUST NOT reveal whether code exists (always 400 with generic message)
- [X] T012 [P] [US1] Add "device offline" warning to `app/components/garden-app.tsx`: show warning banner when `device.lastSeenAt` is older than 15 minutes (3× polling interval per spec)
- [X] T013 [P] [US1] Add pairing UI component `app/components/device-pairing.tsx`: display pairing code, countdown timer to expiry, polling to detect when device completes resolution, success/failure states
- [X] T014 [P] [US1] Add unpair UI to `app/components/garden-app.tsx`: "Unlink device" button that sets `Device.unpairedAt = now` without deleting any `Reading` rows; confirm with modal before action

**Checkpoint**: Full pairing flow verified end-to-end. Calibration endpoint tested with curl. Device offline warning visible when `lastSeenAt` > 15 min.

---

## Phase 4: US2 — ML Prediction Pipeline (Priority: P2)

**Goal**: 4-signal health predictor with gradient-descent online weight learning, model versioning, and rollback. Stateless at inference time.

**Independent Test**: Seed ≥ 3 `MLTrainingSample` rows manually → `POST /api/ml/train` → confirm new `MLModelVersion` with `isActive=true` persisted → `GET /api/ml/predict?plantId=` returns `healthScore`, `stressLevel`, `confidenceScore`, `wateringUrgencyHours`, `breakdown`, `lowConfidenceWarning`.

- [X] T015 [P] [US2] Implement `computeSensorScore`, `computeWeatherRisk`, `computeVisualScore`, `computeLlmConsensus` in `lib/ml/scoring.ts`; each returns a 0–100 score from the relevant `MLFeatures` sub-fields
- [X] T016 [P] [US2] Implement `predict(features: MLFeatures, weights: ModelWeights): MLPrediction` in `lib/ml/model.ts`: weighted sum of the four scores, map to `healthScore` 0–100, derive `stressLevel` (`good`/`watch`/`critical`), compute `wateringUrgencyHours` from moisture slope, compute `confidenceScore`, populate `breakdown` and `dominantSignals`
- [X] T017 [US2] Implement `extractFeatures(plant, latestReading, latestPhoto, weather, insights): MLFeatures` in `lib/ml/features.ts`; weather and insights params are optional — omit their contributions gracefully when unavailable
- [X] T018 [US2] Implement `trainWeights(initial: ModelWeights, samples: TrainingSample[], epochs: number): TrainingResult` in `lib/ml/trainer.ts`: gradient descent with `learning_rate = 0.008`, weights bounded `[0.05, 0.70]` each, renormalised to sum = 1 after each step; compute RMSE, MAE, return `TrainingResult` with final weights and metrics
- [X] T019 [US2] Implement `GET /api/ml/predict` route in `app/api/ml/predict/route.ts`: load active `MLModelVersion` weights from DB; call `extractFeatures` then `predict`; set `lowConfidenceWarning = true` when `confidenceScore < 0.4`; respond with full contract shape from `contracts/api.md`
- [X] T020 [US2] Implement `POST /api/ml/collect` route in `app/api/ml/collect/route.ts`: extract features from latest plant reading + photos + weather + insights; persist `MLTrainingSample`; count new samples since last training run — if count ≥ `ML_AUTO_TRAIN_THRESHOLD` env var (default `10`), trigger `POST /api/ml/train` automatically; return `{ collected, plantId, label, sampleId }`
- [X] T021 [P] [US2] Implement `GET /api/ml/train` route in `app/api/ml/train/route.ts`: return all `MLModelVersion` records ordered by `trainedAt desc` with `version`, `trainedAt`, `sampleCount`, `isActive`, `weights`, `metrics`
- [X] T022 [US2] Implement `POST /api/ml/train` route in `app/api/ml/train/route.ts`: reject if < 3 samples (422); call `trainWeights`; persist new `MLModelVersion` and set `isActive = true` for new version + `false` for all others in a Prisma transaction; compute `improvement` delta vs previous active version; return training result

**Checkpoint**: `GET /api/ml/predict` returns valid prediction shape. Training runs and persists a version. Auto-trigger fires after 10 new samples.

---

## Phase 5: US3 — Photo Storage & Visual Health Analysis (Priority: P3)

**Goal**: Upload plant photos to Railway Object Storage, run multimodal LLM analysis, auto-generate `MLTrainingSample`, handle async retry when LLM unavailable.

**Independent Test**: Upload a photo via `POST /api/photos` → confirm S3 object created → confirm `PlantPhoto` row persisted with analysis → confirm `MLTrainingSample` auto-generated → `GET /api/photos?plantId=` returns photo with analysis. Stream photo via `GET /api/photos/image/[key]` → binary response.

- [X] T023 [P] [US3] Implement `uploadPhoto(buffer, key, mimeType): Promise<void>` and `getPhotoUrl(key): string` in `lib/photo-storage.ts` using `@aws-sdk/client-s3`; S3 client reads `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET` env vars; object key format: `plants/{plantId}/{uuid}.{ext}`
- [X] T024 [US3] Implement `POST /api/photos` route in `app/api/photos/route.ts`: parse multipart/form-data (use `formidable` or Next.js body parsing); validate file (jpeg/png, ≤ 10 MB); upload to S3 via `lib/photo-storage.ts`; call OpenRouter multimodal LLM for visual analysis; if LLM call fails, persist `PlantPhoto` with `analysis=""`, `healthScore=null` (pending state); if LLM succeeds, populate analysis fields and call `POST /api/ml/collect`; return 201 with photo object
- [X] T025 [US3] Add async LLM analysis retry to `app/api/photos/route.ts`: check for `PlantPhoto` rows with `healthScore = null` on each `POST /api/photos` call and reattempt analysis; update `PlantPhoto` and trigger `POST /api/ml/collect` when retry succeeds
- [X] T026 [P] [US3] Implement `GET /api/photos` route in `app/api/photos/route.ts`: list `PlantPhoto` rows for `plantId`, ordered by `createdAt desc`, include `imageUrl` computed from `objectKey`
- [X] T027 [P] [US3] Implement `GET /api/photos/image/[key]` route in `app/api/photos/image/[key]/route.ts`: fetch object from S3 by decoded key; stream binary response with correct `Content-Type`; return 404 if object not found

**Checkpoint**: Full photo lifecycle works. LLM-unavailable path stores photo with pending state. Retry resolves pending photos on next upload.

---

## Phase 6: US4 — Calendar & Care Events (Priority: P4)

**Goal**: CRUD for `CalendarEvent` records with enum-validated fields.

**Independent Test**: `POST /api/calendar` with valid body → 201 with event object. `GET /api/calendar?plantId=` → list includes new event. `PATCH /api/calendar?eventId=` with `{ status: "done" }` → event updated. Invalid `category` → 400.

- [X] T028 [P] [US4] Implement `GET /api/calendar` route in `app/api/calendar/route.ts`: list `CalendarEvent` rows by `plantId`, with optional `status` filter (default `planned`), ordered by `startsAt asc`
- [X] T029 [P] [US4] Implement `POST /api/calendar` route in `app/api/calendar/route.ts`: validate body with Zod (category enum: `check`/`water`/`fertilize`/`repot`/`prune`; priority: `low`/`medium`/`high`/`critical`; source: `manual`/`ai`/`alert`); persist and return 201 with created event
- [X] T030 [US4] Implement `PATCH /api/calendar` route in `app/api/calendar/route.ts`: update `CalendarEvent.status` by `eventId` query param; validate status transition (`planned → done`, `planned → skipped`); return updated event

**Checkpoint**: All three calendar endpoints respond correctly. Enum validation rejects invalid values with 400.

---

## Phase 7: US5 — Weather Integration (Priority: P5)

**Goal**: Open-Meteo proxy returning normalised weather context including ET₀ for ML feature extraction and UI display.

**Independent Test**: `GET /api/weather?location=Brussels, Belgium&timezone=Europe/Brussels` → 200 with `{ current, forecast, et0 }`. Missing `location` → 400.

- [X] T031 [US5] Implement `getWeatherContext(location: string, timezone?: string): Promise<WeatherContext>` and `summarizeWeatherForAgent(ctx: WeatherContext): string` in `lib/weather.ts`; call Open-Meteo API (no API key); parse `tempC`, `humidity`, `rainProbability`, `uvIndex`, `windSpeedMs`, `et0` (Penman-Monteith), daily `forecast` array
- [X] T032 [US5] Implement `GET /api/weather` route in `app/api/weather/route.ts`: validate `location` query param (required); call `getWeatherContext`; return normalised weather contract from `contracts/api.md`

**Checkpoint**: Weather endpoint returns valid data for a known location. `lib/weather.ts` importable by ML features extractor.

---

## Phase 8: US6 — AI Insights (Priority: P6)

**Goal**: LLM-generated plant care insights with 4-hour cache in the `Memory` table, weather-fingerprinted cache key.

**Independent Test**: `GET /api/insights?plantId=` → 200 with 1–4 insights. Second call within 4h → `cached: true`. Change weather context (different location) → cache miss → new insights generated.

- [X] T033 [US6] Implement `getCachedInsights(plantId, weatherCtx): Promise<Insight[] | null>` and `generateInsights(plant, readings, weatherCtx): Promise<Insight[]>` in `lib/insights.ts`; cache in `Memory` table with `kind = "ai_insights_cache"`, TTL = 4 h, cache key = `{plantId}:{location}:{tempC}:{rainProb}`, `version = 2`; insights schema: `{ title, body, tone: "good" | "watch" | "urgent" }`
- [X] T034 [US6] Implement `GET /api/insights` route in `app/api/insights/route.ts`: check cache via `getCachedInsights`; if miss, call `generateInsights`; return `{ insights, cached, generatedAt, expiresAt, weatherIncluded }`

**Checkpoint**: Insights endpoint returns valid data. Cache hit on second call. `expiresAt` is 4 h after `generatedAt`.

---

## Phase 9: US7 — Web Push Notifications (Priority: P7)

**Goal**: W3C Web Push with VAPID; subscriptions persisted in DB; critical/high alerts trigger push to all subscribers.

**Independent Test**: Subscribe via `POST /api/push/subscribe` → row in `PushSubscription`. Trigger `POST /api/push/notify` → notification received in browser. Unsubscribe via `DELETE /api/push/subscribe` → row removed. Critical alert in telemetry ingest → push fires automatically.

- [X] T035 [US7] Implement `sendPushToAll(payload: PushPayload): Promise<{ sent, failed }>` and VAPID setup helpers in `lib/push.ts` using `web-push` npm package; VAPID keys read from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` env vars; remove stale subscriptions on 410 response from push service
- [X] T036 [P] [US7] Implement `POST /api/push/subscribe` route in `app/api/push/subscribe/route.ts`: upsert `PushSubscription` by `endpoint` (W3C PushSubscription JSON body); return `{ ok: true }`
- [X] T037 [P] [US7] Implement `DELETE /api/push/subscribe` route in `app/api/push/subscribe/route.ts`: delete `PushSubscription` by `endpoint`; return `{ ok: true }`
- [X] T038 [P] [US7] Implement `POST /api/push/notify` route in `app/api/push/notify/route.ts`: validate body (`title`, `body`, `url`, `tag`); call `sendPushToAll`; return `{ sent, failed }`
- [X] T039 [US7] Wire push notifications into `app/api/telemetry/route.ts`: after alert severity is determined, if `severity === "critical" || severity === "high"`, call `POST /api/push/notify` with alert details
- [X] T040 [P] [US7] Update `app/components/service-worker-register.tsx`: add `subscribe(publicKey): Promise<void>` and `unsubscribe(): Promise<void>` helpers; call `POST /api/push/subscribe` and `DELETE /api/push/subscribe` respectively; expose `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for subscription
- [X] T041 [P] [US7] Update `public/sw.js`: handle `push` event — call `self.registration.showNotification(data.title, { body, tag, data: { url } })`; handle `notificationclick` — open `event.notification.data.url`

**Checkpoint**: Full push flow works in a Chromium browser. Alert pipeline fires push on critical/high telemetry. Service worker registers without console errors.

---

## Phase 10: US8 — UI Panels (Priority: P8)

**Goal**: Canonical design token system; all existing components migrated (zero magic numbers); new panels: ML Intelligence, Photos, Calendar, Weather widget, AI Insights, Web Push toggle.

**Independent Test**: Inspect any component in DevTools → no inline magic values; all colours/spacings reference `var(--*)` tokens. ML Intelligence Panel shows live prediction and "Train now" button. Photos tab supports upload and shows grid. Calendar tab lists and updates events. Weather widget shows current conditions. Bell icon subscribes to push.

- [X] T042 [US8] Create canonical design token system in `app/globals.css`: define all colour (`--color-*`), spacing (`--spacing-*`), typography (`--text-*`, `--font-*`), radius (`--radius-*`), and motion (`--motion-*`) values as CSS custom properties; replace any existing ad-hoc variables with the canonical tokens
- [X] T043 [US8] Migrate `app/components/garden-app.tsx` to canonical token system: replace all magic numbers (px values, hex colours, hardcoded font sizes) with `var(--*)` references; no inline styles with literal values
- [X] T044 [P] [US8] Migrate all other components in `app/components/` (including `service-worker-register.tsx`, `ml-intelligence-panel.tsx` if pre-existing stubs) to canonical token system; confirm zero magic numbers remain app-wide
- [X] T045 [US8] Implement `app/components/ml-intelligence-panel.tsx`: display current `MLPrediction` (healthScore, stressLevel, confidenceScore, wateringUrgencyHours), 4-signal breakdown bar chart, active model version info, "Train now" button (calls `POST /api/ml/train`), "Collect data" button (calls `POST /api/ml/collect`), version history list from `GET /api/ml/train`; show `lowConfidenceWarning` banner when `confidenceScore < 0.4`; use only canonical tokens
- [X] T046 [US8] Add Photos tab to `app/components/garden-app.tsx`: photo upload form (file input + title + takenAt); call `POST /api/photos`; photo grid calling `GET /api/photos`; per-photo health score badge; "analysis pending" spinner when `healthScore === null`; image rendered via `/api/photos/image/[key]`
- [X] T047 [US8] Add Calendar tab to `app/components/garden-app.tsx`: event list from `GET /api/calendar`; "Mark done" / "Skip" buttons calling `PATCH /api/calendar`; "Add event" form calling `POST /api/calendar` with category/priority selects; ordered by `startsAt`
- [X] T048 [P] [US8] Add Weather widget to `app/components/garden-app.tsx`: current conditions card + 5-day forecast strip from `GET /api/weather`; surface tempC, humidity, rainProbability, uvIndex, et0; pass `weatherLocation` and `timezone` from plant or user settings
- [X] T049 [P] [US8] Add AI Insights section to `app/components/garden-app.tsx`: render 1–4 insights from `GET /api/insights` with tone-coloured icons (`good` → green, `watch` → amber, `urgent` → red); show cached/fresh badge and expiry countdown
- [X] T050 [P] [US8] Add Web Push bell icon to `app/components/garden-app.tsx`: use `service-worker-register.tsx` helpers; toggle subscribe/unsubscribe on click; show subscribed state; handle permission denial gracefully

**Checkpoint**: Full app renders without console errors. All panels functional. DevTools shows only token-based CSS values.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Observability, quality gates, and final validation across all stories.

- [X] T051 Add structured JSON logging (`console.log(JSON.stringify({...}))`) to all new API routes: log `plantId`, `deviceSerial`, latency (ms), status code, and relevant context on every request in `app/api/ml/`, `app/api/photos/`, `app/api/push/`, `app/api/calendar/`, `app/api/insights/`, `app/api/weather/`
- [X] T052 [P] Run full quality gate suite from `quickstart.md`: `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`, `npm audit --audit-level=high`, `npm run build` — fix all errors before marking done
- [X] T053 [P] Validate performance targets: manually time `POST /api/telemetry` (< 200 ms target), `GET /api/ml/predict` (< 500 ms target) using curl with `-w "%{time_total}"`; document results
- [X] T054 [P] Update `README.md`: add new env vars section, brief feature summary (ML pipeline, photos, calendar, weather, push, pairing), and link to `quickstart.md`
- [X] T055 Validate `quickstart.md` walkthrough end-to-end against the final implementation: confirm all commands work, env var names match, and the ML pipeline walkthrough steps produce correct results

**Checkpoint**: All quality gates pass. Build succeeds. README is accurate. Quickstart is validated.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational) ← BLOCKS all user stories
            ├── Phase 3 (US1 Device Pairing)   ← required before merge
            ├── Phase 4 (US2 ML Pipeline)
            ├── Phase 5 (US3 Photos)            ← depends on US2 types (T005)
            ├── Phase 6 (US4 Calendar)
            ├── Phase 7 (US5 Weather)           ← feeds US2 extractFeatures
            ├── Phase 8 (US6 Insights)          ← depends on US5 weather lib
            ├── Phase 9 (US7 Push)
            └── Phase 10 (US8 UI)               ← depends on all API phases
                    └── Phase 11 (Polish)
```

### User Story Dependencies

| Story | Can start after | Notes |
|---|---|---|
| US1 (R1 Device Pairing) | Phase 2 | Completely independent; MUST ship before merge |
| US2 (R2 ML Pipeline) | Phase 2 | `lib/ml/types.ts` (T005) is in Phase 2 — already available |
| US3 (R3 Photos) | Phase 2 + US2 types | Photo upload auto-calls `/api/ml/collect`; US2 routes should exist first |
| US4 (R4 Calendar) | Phase 2 | Fully independent |
| US5 (R5 Weather) | Phase 2 | Fully independent; `lib/weather.ts` needed by US2 Phase 4 |
| US6 (R6 Insights) | US5 (T031) | `lib/insights.ts` calls `lib/weather.ts` for cache key |
| US7 (R7 Push) | Phase 2 | Mostly independent; T039 wires into telemetry (needs existing route) |
| US8 (R8 UI) | US2, US3, US4, US5, US6, US7 | Panels call all API routes — build last |

### Within Each User Story

1. Lib utilities before API routes
2. API routes before UI components
3. Foundational Prisma changes before any route that queries new tables

---

## Parallel Opportunities Per Story

```bash
# Phase 2 — run in parallel:
T005 lib/ml/types.ts
T006 firmware/drivers/tsl2561.py

# Phase 3 US1 — run in parallel after T009 (rate limit helper):
T010 POST /api/devices/pair
T012 Device offline warning (garden-app.tsx)
T013 device-pairing.tsx UI component
T014 Unpair UI

# Phase 4 US2 — run in parallel:
T015 lib/ml/scoring.ts
T016 lib/ml/model.ts
(then T017 lib/ml/features.ts depends on T015)
T021 GET /api/ml/train (independent of T020 predict)

# Phase 5 US3 — run in parallel:
T023 lib/photo-storage.ts
T026 GET /api/photos
T027 GET /api/photos/image/[key]

# Phase 6 US4 — run in parallel:
T028 GET /api/calendar
T029 POST /api/calendar

# Phase 9 US7 — run in parallel:
T036 POST /api/push/subscribe
T037 DELETE /api/push/subscribe
T038 POST /api/push/notify
T040 service-worker-register.tsx
T041 public/sw.js

# Phase 10 US8 — run in parallel (after T042 tokens + T043 migration):
T044 Migrate remaining components
T048 Weather widget
T049 AI Insights section
T050 Push bell icon
```

---

## Implementation Strategy

### MVP First (Constitution §I compliance)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (blocks everything)
3. Complete Phase 3: US1 Device Pairing ← **REQUIRED BEFORE MERGE**
4. **Validate**: Full pairing flow works end-to-end
5. Continue with remaining user stories (US2–US8) in parallel or sequential

### Incremental Delivery

1. Setup + Foundational → Schema ready, types available
2. US1 (Pairing) → Constitution §I satisfied → branch can now merge once all phases done
3. US2 (ML) → Prediction pipeline live
4. US3 (Photos) → Visual health analysis + auto-sample collection
5. US5 (Weather) → Weather context available for ML and UI
6. US6 (Insights) → AI-powered insights cached and served
7. US4 (Calendar) → Care event tracking
8. US7 (Push) → Background alerts
9. US8 (UI) → All panels wired up, token system applied
10. Phase 11 (Polish) → Quality gates pass → ready to merge

### Quality Gate (run before merge)

```bash
npm run lint
npx tsc --noEmit
npx prisma validate
npm audit --audit-level=high
npm run build
```

---

## Notes

- `[P]` tasks operate on different files — safe to run in parallel
- `[USn]` maps each task to its requirement for traceability
- US1 (Device Pairing) is a non-negotiable Constitution §I requirement — the branch CANNOT merge without it
- No test tasks: verification is manual + CLI quality gates per `quickstart.md`
- Commit after each completed task or logical group
- Stop at each **Checkpoint** to verify the story independently before proceeding
