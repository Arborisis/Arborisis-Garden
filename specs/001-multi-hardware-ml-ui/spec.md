# Feature Specification: Multi-Hardware ML Intelligence & UI Expansion

**Branch**: `001-multi-hardware-ml-ui` | **Date**: 2026-05-30

## Overview

Extend the Arborisis Garden companion app with three integrated capabilities:

1. **Multi-hardware architecture** — proper many-to-one Device→Plant data model, per-plant moisture calibration (raw dry/wet ADC values), and a firmware TSL2561 driver fix for accurate lux readings under varying gain/integration settings.

2. **ML intelligence pipeline** — a 4-signal health predictor (soil sensors, photo/visual, weather, LLM consensus) trained online via gradient-descent weight learning. Model versions are persisted with rollback support. Every photo analysis auto-generates an `MLTrainingSample` row.

3. **UI feature expansion** — new panels in the PWA: Photos tab, Calendar tab, Weather widget, Web Push notifications, AI insights (LLM-generated, 4-hour TTL cache), and an ML Intelligence Panel showing the live prediction, signal breakdown, and training controls.

## Requirements

### R1 — Multi-hardware device model & pairing

- A `Device` entity MUST be introduced with fields: `serial`, `name`, `hashedToken`, `lastSeenAt`, `wifiRssi`, `firmwareVersion`, `pairedAt`, `unpairedAt`, `userId`.
- The system MUST support an unbounded number of Devices per user account; each Plant is linkable to at most one active Device at a time.
- Device pairing MUST be initiated via a 6–8 alphanumeric code displayed in the web UI, expiring after 15 minutes, single-use only.
- The server MUST hash and store only the resolved device token after pairing; the raw pairing code MUST NOT be persisted beyond validation.
- Pairing endpoints MUST enforce rate limiting: max 5 failed attempts per IP per minute; failure responses MUST NOT reveal whether a code exists.
- Unpairing a Device from the web UI MUST NOT delete any historical readings.
- The telemetry ingest endpoint MUST be idempotent: duplicate readings identified by `(deviceSerial, recordedAt)` MUST be silently deduplicated.
- Sensor readings MUST be validated server-side against physiological bounds; out-of-bound values trigger a `SENSOR_FAULT` alert and are not written to the database.
- The Pico firmware MUST send telemetry on a 5-minute polling interval; the web app MUST display a "device offline" warning when no reading has arrived within 15 minutes (3× polling interval).
- TSL2561 driver MUST expose `integration_ms` and `gain_16x` settings and use them in the lux scaling formula.
- Plant schema MUST store `moistureDryRaw` and `moistureWetRaw` calibration values.
- `POST /api/plants/calibrate` MUST accept and persist raw ADC calibration values per plant.

### R2 — ML prediction pipeline
- `GET /api/ml/predict?plantId=` MUST return an `MLPrediction` with `healthScore`, `stressLevel`, `confidenceScore`, `wateringUrgencyHours`, and a `breakdown` object covering the four signals.
- `POST /api/ml/collect` MUST extract features from the latest plant readings + photos + weather + insights and persist `MLTrainingSample` rows.
- `POST /api/ml/train` MUST run gradient-descent weight optimisation over collected samples and persist a new `MLModelVersion`. Minimum 3 samples required.
- Retraining MUST also be triggered automatically when the number of new `MLTrainingSample` rows since the last training run reaches a configured threshold (default: 10 new samples); the threshold MUST be configurable without a code deploy.
- The ML Intelligence Panel MUST provide a manual "Train now" button that triggers retraining on demand regardless of the sample threshold.
- `GET /api/ml/train` MUST return the list of `MLModelVersion` records (version, weights, metrics, isActive).
- Prediction MUST be stateless at inference time — weights are loaded from the active `MLModelVersion`.
- Confidence MUST surface a low-data warning when below 0.4.

### R3 — Photo storage and visual health analysis
- `POST /api/photos` MUST accept a plant photo and store it in Railway Object Storage immediately; multimodal LLM analysis is then queued for async execution.
- If LLM analysis is unavailable at upload time, the photo MUST be stored and the analysis retried asynchronously; the UI MUST show an "analysis pending" state until complete.
- Once analysis completes (sync or async), an `MLTrainingSample` MUST be auto-generated from the result.
- `GET /api/photos?plantId=` MUST return the plant's photo list with analysis metadata.
- `GET /api/photos/image/[key]` MUST stream the raw image from object storage.

### R4 — Calendar & care events
- `GET/POST /api/calendar?plantId=` MUST support listing and creating `CalendarEvent` rows.
- `PATCH /api/calendar?eventId=` MUST support updating event status.

### R5 — Weather integration
- `GET /api/weather?location=&timezone=` MUST proxy Open-Meteo and return a normalised weather context.
- Weather data MUST be used in ML feature extraction for `weatherTempNorm`, `rainProbability`, `et0Norm`, `uvNorm`, `wateringWindowScore`.

### R6 — AI insights
- `GET /api/insights?plantId=` MUST return 1–4 LLM-generated insights with `title`, `body`, and `tone` (`good` | `watch` | `urgent`).
- Insights MUST be cached in the `Memory` table (kind `ai_insights_cache`) for 4 hours and MUST include weather context in the cache key.

### R7 — Web Push notifications
- `POST /api/push/subscribe` / `DELETE /api/push/subscribe` MUST manage `PushSubscription` records.
- `POST /api/push/notify` MUST send a push notification to all active subscriptions.
- Critical and high-severity alerts MUST trigger push notifications.

### R8 — UI panels
- `MLIntelligencePanel` MUST display: current prediction, 4-signal breakdown, model version, training button, and version history.
- Photos tab MUST support upload, display, and per-photo health score.
- Calendar tab MUST list upcoming care events.
- Weather widget MUST show current conditions relevant to plant care.
- A canonical design token system MUST be created, defining all colour, spacing, typography, radius, and motion values as CSS custom properties or a dedicated token file.
- ALL existing components MUST be migrated to use the token system; magic numbers in any component stylesheet are forbidden after this feature ships.
- All new panels MUST use only the canonical token system.

## Clarifications

### Session 2026-05-30

- Q: Does this feature include implementing the full device pairing UI and security flow, or only the database schema changes for multi-device? → A: Full pairing flow included — code generation UI, expiry, single-use validation, rate limiting, hashed token storage.
- Q: Does this feature include creating the canonical design token system from scratch and migrating existing components, or only applying existing tokens to new panels? → A: Create canonical token system AND migrate all existing components — zero magic numbers app-wide after this feature ships.
- Q: Should ML retraining trigger only on manual user action, or also automatically when enough new samples accumulate? → A: Both — auto-trigger when new sample threshold is reached (default: 10), plus manual "Train now" button in the ML Intelligence Panel.
- Q: If the multimodal LLM service is unavailable when a user uploads a photo, what should happen? → A: Store photo immediately in object storage, queue analysis for async retry; UI shows "analysis pending" until LLM analysis completes and MLTrainingSample is generated.
- Q: What is the expected telemetry polling interval for a Pico device? → A: 5 minutes; device offline warning triggers after 15 minutes (3× polling interval) of no received readings.

## Out of scope (this branch)
- Authentication/multi-user (single-user assumed)
- Staging environment setup
- E2E tests
