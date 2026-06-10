# Arborisis Garden

**AI-powered plant monitoring — Raspberry Pi Pico WH + Grove sensors + Next.js PWA**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Arborisis/Arborisis-Garden)

A self-hosted, open-source plant companion that combines IoT sensor telemetry, on-device ML health scoring, photo-based visual analysis, weather integration, and push notifications — all in a single Next.js PWA deployed on Railway.

---

## Features

- **Real-time telemetry** — Raspberry Pi Pico WH sends soil moisture, temperature, humidity, pressure, and light readings every 45 s over Wi-Fi
- **4-signal ML health score** — gradient-descent online model fuses sensor data, visual analysis, weather risk, and LLM consensus into a 0–100 plant health score with model versioning and rollback
- **Photo analysis** — upload photos from any device; LLM multimodal analysis extracts health score, anomaly detection, colour tags, and care recommendations
- **Weather integration** — free Open-Meteo proxy (no API key required); Penman-Monteith ET₀ evapotranspiration
- **AI insights** — LLM-generated care tips cached 4 h, indexed by weather fingerprint
- **Care calendar** — create, schedule, and track watering, fertilising, pruning events
- **Web Push notifications** — W3C VAPID push alerts for critical/high-severity conditions, works with the PWA closed
- **Offline buffering** — Pico buffers up to 60 readings in RAM while offline and flushes oldest-first on reconnect
- **Local diagnostics** — Pico hosts a live HTML dashboard on its LAN IP (`/`) and JSON endpoints (`/api/readings`, `/api/diagnostics`)
- **Per-plant moisture calibration** — two-point ADC calibration stored in the app database
- **Device pairing** — 6-character one-time pairing codes, 15-minute expiry, bcrypt token auth
- **PWA** — installable on iOS, Android, and desktop; offline shell

---

## Hardware

### Bill of Materials

| # | Component | Notes |
|---|-----------|-------|
| 1 | [Raspberry Pi Pico WH](https://www.raspberrypi.com/products/raspberry-pi-pico/) | Wi-Fi + pre-soldered headers — WH variant required |
| 2 | [Grove Shield for Pi Pico v1](https://wiki.seeedstudio.com/Grove_Shield_for_Pi_Pico_V1_0/) | Provides Grove connectors; power switch must be set to **3.3 V** |
| 3 | [Grove Capacitive Soil Moisture Sensor](https://wiki.seeedstudio.com/Grove-Capacitive_Moisture_Sensor-Corrosion-Resistant/) | Resistive sensor also works; plug into **A0** |
| 4 | [DS18B20 Waterproof Soil Temperature Probe](https://www.adafruit.com/product/381) | 1-Wire; any brand with 4.7 kΩ pull-up |
| 5 | [Grove BME280 Environmental Sensor](https://wiki.seeedstudio.com/Grove-Barometer_Sensor-BME280/) | Reads air temperature, humidity, and pressure over I2C |
| 6 | [Grove Digital Light Sensor TSL2561](https://wiki.seeedstudio.com/Grove-Digital_Light_Sensor/) | Wide dynamic range lux; auto-gain from 1 lx to ~40 000 lx |
| 7 | USB-C / Micro-USB power supply | 5 V for Pico, 3.3 V regulated by the shield |

Optional: LiPo battery + charging board for portable/greenhouse deployment — set `BATTERY_ADC_PIN = 29` in `config.py` to monitor VSYS.

### Wiring

**Grove Shield power switch → 3.3 V** (left position)

| Sensor | Grove port | Pico GPIO | Protocol |
|--------|-----------|-----------|----------|
| Soil moisture (capacitive) | A0 | GP26 (ADC0) | Analog |
| Soil temperature (DS18B20) | D18 | GP18 | 1-Wire |
| BME280 (air temp / humidity / pressure) | I2C0 — SDA/SCL | GP8 / GP9 | I2C 0x76 |
| TSL2561 (light) | I2C1 — SDA/SCL | GP6 / GP7 | I2C 0x39 |
| Battery voltage (optional) | — | GP29 (ADC3) | Analog 3:1 divider |

```
Pico WH (top view, USB at top)
───────────────────────────────────
GP6  SDA ─── I2C1 ─── TSL2561 SDA
GP7  SCL ─── I2C1 ─── TSL2561 SCL
GP8  SDA ─── I2C0 ─── BME280  SDA
GP9  SCL ─── I2C0 ─── BME280  SCL
GP18 ──────── 1-Wire ─ DS18B20 DATA (+ 4.7 kΩ pull-up to 3.3 V)
GP26 ──────── ADC0 ─── Capacitive Moisture OUT
GP29 ──────── ADC3 ─── VSYS/3 (battery monitoring, optional)
3.3V/GND ─── all sensor VCC / GND
───────────────────────────────────
```

### Sensor Notes

- **Moisture calibration**: the raw ADC range varies by sensor brand. Default dry = 52 000, wet = 22 000 (12-bit ADC, ~0–65 535). Calibrate via the app UI after first boot.
- **TSL2561 address**: auto-detected from `0x39` → `0x29` → `0x49`. The driver applies auto-gain (1× / 16×) and normalises counts to the 402 ms / 16× reference the datasheet lux formula assumes.
- **DS18B20**: the firmware rejects the 85 °C power-on sentinel value and temperatures outside −40…85 °C.
- **BME280**: default I2C address is `0x76`. If your module uses `0x77`, edit `drivers/bme280.py`.

---

## One-Click Deploy on Railway

Click the button above, then:

1. **Connect your GitHub account** and fork the repo into your account.
2. **Add a PostgreSQL service** — Railway will provision it automatically if you click *New → Database → PostgreSQL* before deploying.
3. **Add an Object Storage bucket** (Railway Object Storage, S3-compatible) for plant photos — optional but recommended.
4. **Set environment variables** — see the table below. The minimum required set is `DATABASE_URL`, `DEVICE_INGEST_TOKEN`, and `OPENROUTER_API_KEY`.
5. Click **Deploy** — the multi-stage Dockerfile handles `prisma generate`, `next build`, and `prisma migrate deploy` at startup.

The app will be live at `https://<your-service>.up.railway.app` within a few minutes.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **yes** | PostgreSQL connection string. In Railway: `${{Postgres.DATABASE_URL}}` |
| `DEVICE_INGEST_TOKEN` | **yes** | Shared secret sent by each Pico in `X-Device-Token`; use a random 32-char string |
| `OPENROUTER_API_KEY` | **yes** | [OpenRouter](https://openrouter.ai) API key for LLM analysis and AI insights |
| `OPENROUTER_MODEL` | no | Main LLM model — agent, chat, calibration (default: `anthropic/claude-opus-4.8`) |
| `OPENROUTER_VISION_MODEL` | no | Photo analysis model (default: `OPENROUTER_MODEL`, then `anthropic/claude-opus-4.8`) |
| `OPENROUTER_INSIGHTS_MODEL` | no | Dashboard insights model (default: `anthropic/claude-sonnet-4.6`) |
| `OPENROUTER_COMPACT_MODEL` | no | Conversation compaction model (default: `anthropic/claude-haiku-4.5`) |
| `OPENROUTER_REASONING_EFFORT` | no | Extended reasoning on agent/vision/calibration: `low`/`medium`/`high`/`off` (default: `high`) |
| `STORAGE_ENDPOINT` | no | Railway Object Storage endpoint URL (for plant photos) |
| `STORAGE_ACCESS_KEY_ID` | no | Object Storage access key |
| `STORAGE_SECRET_ACCESS_KEY` | no | Object Storage secret key |
| `STORAGE_BUCKET` | no | Bucket name (default: `arborisis-photos`) |
| `VAPID_PUBLIC_KEY` | no | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | no | VAPID private key for Web Push |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | no | Same as `VAPID_PUBLIC_KEY` — exposed to the browser |
| `VAPID_SUBJECT` | no | Push notification contact: `mailto:you@example.com` |
| `ML_AUTO_TRAIN_THRESHOLD` | no | New samples before auto-training triggers (default: `10`) |
| `OPENROUTER_WEB_SEARCH_ENGINE` | no | Search engine for web-augmented LLM queries (`auto`, `exa`, `firecrawl`) |

**Generating VAPID keys:**
```bash
npx web-push generate-vapid-keys
```

---

## Local Development

### Prerequisites

- Node.js ≥ 22
- PostgreSQL (local install, Docker, or Railway tunnel)

```bash
git clone https://github.com/Arborisis/Arborisis-Garden.git
cd Arborisis-Garden
npm install
cp .env.example .env        # fill in DATABASE_URL and DEVICE_INGEST_TOKEN at minimum
npm run db:push              # push schema to DB (no migration files, for local dev)
npm run dev                  # starts Next.js on http://localhost:3000
```

Open `http://localhost:3000`. To receive data from a Pico on the same network, set the Pico's API URL to `http://<your-machine-ip>:3000/api/telemetry`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm start` | Run migrations then start production server |
| `npm run test` | Backend smoke tests (`tsx tests/backend-smoke.ts`) |
| `npm run lint` | ESLint |
| `npx prisma studio` | Visual DB browser |

---

## Firmware

### Flash MicroPython

1. Hold BOOTSEL, plug in Pico WH via USB — it mounts as `RPI-RP2`.
2. Download the latest [MicroPython UF2 for Pico W](https://micropython.org/download/RPI_PICO_W/) and drag it onto `RPI-RP2`.
3. The Pico reboots into MicroPython.

### Upload Firmware Files

```bash
# Using mpremote (pip install mpremote)
mpremote cp firmware/config.py firmware/main.py :
mpremote cp -r firmware/drivers :drivers
# Optional: BLE provisioning
mpremote cp firmware/ble_service.py :
```

### First Boot — Wi-Fi Provisioning

If no Wi-Fi credentials are saved, the Pico creates an access point:

| Setting | Value |
|---------|-------|
| SSID | `Arborisis-<last-6-of-serial>` |
| Password | `arborisis` |
| Setup URL | `http://192.168.4.1` |

Connect to that network from your phone or laptop, open `http://192.168.4.1`, and fill in:
- Wi-Fi SSID + password
- API URL: `https://your-app.up.railway.app/api/telemetry`
- Device token: the value of `DEVICE_INGEST_TOKEN`

The Pico saves the config to `arborisis_config.json` and reboots into normal operation.

### Status LED

| Pattern | Meaning |
|---------|---------|
| Blinking (250 ms on/off) | Connecting to Wi-Fi |
| Solid on | Provisioning (setup AP) mode |
| Double blink every ~45 s | Successful read + POST cycle |
| Off | Idle between cycles |

### Calibrating the Moisture Sensor

Raw ADC counts vary by sensor brand. Calibrate once per sensor:

1. Open the plant settings in the web app → **Calibrer capteur**.
2. With the sensor in **dry air**, read the raw value — save as `moistureDryRaw`.
3. Insert the sensor in **saturated soil or water**, read the raw value — save as `moistureWetRaw`.

Alternatively, read the values from the Pico serial console and update `arborisis_config.json` directly.

### Offline Buffering

The Pico buffers up to 60 readings in RAM while the API is unreachable. On reconnect it flushes them oldest-first. 4xx responses (bad token, schema error) are dropped immediately — fix the config, don't retry.

### Firmware Update

```bash
mpremote cp firmware/config.py firmware/main.py :
mpremote cp -r firmware/drivers :drivers
```

No hard reset is needed; the watchdog will pick up the new code on the next crash or you can `mpremote reset`.

### Firmware Version History

| Version | Changes |
|---------|---------|
| 0.2.0 | Hardware watchdog, offline buffering, NTP timestamps, median-filtered ADC, TSL2561 auto-gain, Wi-Fi backoff, status LED, local diagnostics dashboard |
| 0.1.1 | TSL2561 lux scaling fix (normalise raw counts to 402 ms / 16× reference before datasheet formula) |
| 0.1.0 | Initial release |

### Bioelectric firmware (2nd Pico) — `firmware-bio/`

A **separate, standalone firmware** for a second Pico W/WH that measures plant
**bioelectricity** (stem↔soil biopotential) through an analog front-end
(AD8232 / Grove EMG / INA instrumentation amp). It samples a window
(default 128 Hz × 4 s), computes per-window features + a decimated waveform, and
POSTs to `/api/bioelectric`. The server **auto-attaches** these readings to the
plant of the most recently active environmental Pico, then correlates bio
activity around watering events to detect whether the plant **reacts** (surfaced
in the **Bioélectricité** panel and fed to the ML bio expert + LLM insights).

```bash
mpremote cp firmware-bio/config.py firmware-bio/main.py firmware-bio/biosignal.py :
```

Wiring, electrode placement, front-end options and gain calibration:
see [`firmware-bio/README.md`](firmware-bio/README.md). Sampling frequency and
window length are tunable from the setup page (no reflash).

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Railway (production)                │
│                                                       │
│  ┌─────────────────────────┐   ┌───────────────────┐ │
│  │   Next.js PWA (App Router) │   │  PostgreSQL       │ │
│  │                         │   │  (Prisma 5)       │ │
│  │  /api/telemetry  ◄──────┼───┤  Device, Plant,   │ │
│  │  /api/ml/predict        │   │  Reading, Alert,  │ │
│  │  /api/ml/train          │   │  MLModelVersion,  │ │
│  │  /api/photos            │   │  PlantPhoto,      │ │
│  │  /api/calendar          │   │  CalendarEvent,   │ │
│  │  /api/insights          │   │  PushSubscription │ │
│  │  /api/weather           │   └───────────────────┘ │
│  │  /api/push/*            │                         │
│  │                         │   ┌───────────────────┐ │
│  │  lib/ml/                │   │  Object Storage   │ │
│  │  ├─ features.ts         │   │  (S3-compatible)  │ │
│  │  ├─ model.ts            │   │  plant photos     │ │
│  │  ├─ scoring.ts          │   └───────────────────┘ │
│  │  └─ trainer.ts          │                         │
│  │                         │   ┌───────────────────┐ │
│  │  lib/agentic/           │   │  OpenRouter LLM   │ │
│  │  (orchestrator, tools,  │───►  (visual analysis,│ │
│  │   memory, prompts)      │   │   AI insights)    │ │
│  └─────────────────────────┘   └───────────────────┘ │
└──────────────────────────────────────────────────────┘
             ▲ HTTPS /api/telemetry
             │ X-Device-Token: <bcrypt>
             │
┌─────────────────────────────────────┐
│  Raspberry Pi Pico WH (MicroPython) │
│  firmware/main.py                   │
│                                     │
│  Sensors (every 45 s):              │
│  - Soil moisture (ADC, 9-sample     │
│    median, 2-point calibrated)      │
│  - Soil temperature (DS18B20)       │
│  - Air temp / humidity / pressure   │
│    (BME280, I2C0)                   │
│  - Light lux (TSL2561, I2C1,        │
│    auto-gain 1×/16×)                │
│  - Battery voltage (optional)       │
│  - Wi-Fi RSSI                       │
│                                     │
│  Local web: http://<pico-ip>/       │
│  /api/readings  /api/diagnostics    │
└─────────────────────────────────────┘
```

### ML Pipeline

```
Photo upload / manual trigger
        │
        ▼
POST /api/ml/collect
  extractFeatures(plant, weather, insights)
  → MLTrainingSample (features JSON + health label)
        │
        ▼ (≥ 3 samples OR auto-threshold reached)
POST /api/ml/train
  trainWeights(initialWeights, samples, epochs=500)
  gradient descent on 4 bounded weights:
    [sensorWeight, visualWeight, weatherWeight, llmWeight]
  → MLModelVersion persisted, isActive = true
        │
        ▼
GET /api/ml/predict?plantId=…
  predict(features, activeWeights)
  → healthScore (0–100)
     stressLevel (good / watch / stress / critical)
     wateringUrgencyHours
     confidenceScore
     breakdown by signal
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/telemetry` | Receive sensor reading from Pico; auth: `X-Device-Token` |
| `GET/POST` | `/api/bioelectric` | Bioelectric window from 2nd Pico (POST, `X-Device-Token`) / list readings + detected reactions (GET) |
| `GET` | `/api/plants` | List plants |
| `POST` | `/api/plants` | Create plant |
| `POST` | `/api/plants/calibrate` | Update moisture calibration (dry/wet raw values) |
| `GET` | `/api/ml/predict` | Get ML health prediction for a plant |
| `GET/POST` | `/api/ml/train` | List model versions / trigger training |
| `POST` | `/api/ml/collect` | Extract and store ML training sample |
| `GET/POST` | `/api/photos` | List / upload plant photo (triggers LLM analysis) |
| `GET/POST/PATCH` | `/api/calendar` | List / create / update care events |
| `GET` | `/api/insights` | LLM care insights, cached 4 h |
| `GET` | `/api/weather` | Open-Meteo weather proxy |
| `POST/DELETE` | `/api/push/subscribe` | Register / remove Web Push subscription |
| `POST` | `/api/push/notify` | Send push notification to all subscribers |
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/devices` | List paired devices |
| `POST` | `/api/devices/pair` | Generate pairing code |
| `GET` | `/api/chat` | AI chat for a plant (streaming) |

Full request/response contracts: [`specs/001-multi-hardware-ml-ui/contracts/api.md`](specs/001-multi-hardware-ml-ui/contracts/api.md)

---

## Quality Gates

```bash
npm run lint
npx tsc --noEmit
npm audit --audit-level=high
npx prisma validate
npm run build
npm run test
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Lucide icons |
| Backend | Next.js API routes, TypeScript 5, Node.js 22 |
| Database | PostgreSQL + Prisma 5 |
| ML | Custom gradient-descent weight learner (no external ML deps) |
| Storage | Railway Object Storage (S3-compatible), `@aws-sdk/client-s3` |
| LLM | OpenRouter (`anthropic/claude-opus-4.8` agent/vision, `anthropic/claude-sonnet-4.6` insights, `anthropic/claude-haiku-4.5` compaction) |
| Weather | Open-Meteo (free, no API key) |
| Push | W3C Web Push + VAPID (`web-push`) |
| IoT firmware | MicroPython 1.23 on Raspberry Pi Pico WH |
| Deploy | Railway, Docker multi-stage |

---

## License

MIT — see [LICENSE](LICENSE)
