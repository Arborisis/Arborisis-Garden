# Research: 001-multi-hardware-ml-ui

## ML weight-learning approach

**Decision**: Gradient-descent on normalised ensemble weights (4 parameters: sensor, visual, weather, llm), constrained to [0.05, 0.70] each, sum = 1.

**Rationale**: The problem is a simple 4-variable linear combination with bounded coefficients. Gradient descent with learning_rate = 0.008 converges in 20–50 epochs for typical sample sizes (3–500). A neural network would overfit with < 100 samples; a Bayesian approach adds implementation complexity with no measurable benefit at this scale.

**Alternatives considered**:
- Random forest on raw features — rejected: requires scikit-learn on the server, adds Python runtime dependency.
- Fixed weights only — rejected: violates Constitution §III (continuous online improvement).
- Bayesian weight posterior — rejected: disproportionate complexity for a 4-parameter model.

---

## Weather data source

**Decision**: Open-Meteo (free, no API key, JSON REST API).

**Rationale**: Covers global locations, provides ET₀ (Penman-Monteith), UV index, precipitation probability, and hourly forecast — all signals required by the ML features spec. No rate-limiting at this usage volume.

**Alternatives considered**:
- OpenWeatherMap — requires paid tier for hourly data + API key management.
- WeatherAPI — similar cost constraint.

---

## Photo storage backend

**Decision**: Railway Object Storage (S3-compatible bucket via `@aws-sdk/client-s3`).

**Rationale**: Already available in the Railway project; avoids adding a second cloud vendor. Photos are stored as binary objects under `plants/{plantId}/{uuid}.{ext}`; only the object key is persisted in the database. Constitution §II (secrets in env vars) satisfied by `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET` env vars.

**Alternatives considered**:
- Cloudflare R2 — viable, but requires a second vendor credential set.
- Database BLOBs — explicitly prohibited by Constitution (Production & Infrastructure Requirements).

---

## Web Push implementation

**Decision**: `web-push` npm package with VAPID keys.

**Rationale**: Standard W3C Push API, supported by all major browsers. VAPID keys stored in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars. Push subscriptions persisted in `PushSubscription` table (endpoint unique).

**Alternatives considered**:
- Firebase Cloud Messaging — vendor lock-in, overkill for single-user app.
- Server-Sent Events — doesn't work when browser tab is closed.

---

## TSL2561 lux scaling

**Decision**: Expose `integration_ms` (default 402 ms) and `gain_16x` (default off) as instance variables; apply normalization factors `scale = 402 / integration_ms × (1 if gain_16x else 16)` before the lux formula.

**Rationale**: The original driver applied the datasheet formula directly to raw channel counts without accounting for gain/integration time, causing 16× under-reading at default settings. The fix aligns with TSL2561 Application Note §3.2.

**Alternatives considered**:
- Hardcode gain_16x = True — forces higher gain globally; inappropriate for high-light conditions where gain_16x saturates the sensor.

---

## AI insights caching

**Decision**: Cache `ai_insights_cache` in the `Memory` table (kind field), 4-hour TTL, cache key includes a weather fingerprint (`location:tempC:rainProb`). Version field = 2 to invalidate legacy format.

**Rationale**: LLM inference costs $0.002–0.01 per call at this prompt length. Refreshing every page load would be expensive and provide no incremental value (sensor data changes slowly). 4-hour TTL balances freshness with cost.

**Alternatives considered**:
- Redis cache — adds infrastructure dependency; overkill for single-user.
- No cache — violates cost and latency requirements.
