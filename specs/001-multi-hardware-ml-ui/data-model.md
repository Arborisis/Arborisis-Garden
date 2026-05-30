# Data Model: 001-multi-hardware-ml-ui

## Existing entities (modified)

### Device
No new fields required beyond the existing schema. `tokenHash` stores the bcrypt hash of the device token resolved after pairing code validation.

> **Implementation gap**: A `PairingCode` entity is required by the constitution (§I) and spec R1 but is not yet in `schema.prisma`. See the Remaining Work section below.

### Plant
Added fields:
| Field | Type | Default | Purpose |
|---|---|---|---|
| `moistureDryRaw` | Int | 52000 | ADC count at 0% soil moisture (air-dry calibration) |
| `moistureWetRaw` | Int | 22000 | ADC count at 100% soil moisture (fully saturated) |

Calibration formula: `moisturePct = clamp((dryRaw - rawReading) / (dryRaw - wetRaw) × 100, 0, 100)`

### Device
No schema changes; `tokenHash` remains nullable (set after pairing).

---

## New entities

### PlantPhoto
Stores metadata for photos uploaded by the user and analysed by the LLM.

| Field | Type | Constraints |
|---|---|---|
| `id` | String (cuid) | PK |
| `plantId` | String | FK → Plant, required |
| `title` | String | user-provided or auto-generated |
| `objectKey` | String | unique; S3 object path `plants/{plantId}/{uuid}.{ext}` |
| `mimeType` | String | `image/jpeg` or `image/png` |
| `sizeBytes` | Int | raw file size |
| `takenAt` | DateTime? | EXIF or upload time |
| `analysis` | String | free-text LLM analysis (default `""`) |
| `observations` | String | JSON array of observation strings |
| `recommendations` | String | JSON array of recommendation strings |
| `healthScore` | Int? | 0–100 LLM-estimated health score |
| `confidence` | Float | 0–1 LLM confidence (default 0) |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

Index: `(plantId, createdAt)`

### CalendarEvent
Tracks upcoming plant care tasks and reminders.

| Field | Type | Default |
|---|---|---|
| `id` | String (cuid) | PK |
| `plantId` | String | FK → Plant |
| `title` | String | — |
| `description` | String? | — |
| `startsAt` | DateTime | — |
| `endsAt` | DateTime? | — |
| `category` | String | `check` |
| `priority` | String | `medium` |
| `status` | String | `planned` |
| `source` | String | `manual` |

Valid `category` values: `check`, `water`, `fertilize`, `repot`, `prune`
Valid `priority` values: `low`, `medium`, `high`, `critical`
Valid `status` values: `planned`, `done`, `skipped`
Valid `source` values: `manual`, `ai`, `alert`

Indexes: `(plantId, startsAt)`, `(plantId, status, startsAt)`

### PushSubscription
Stores Web Push API subscriptions.

| Field | Type | Constraints |
|---|---|---|
| `id` | String (cuid) | PK |
| `endpoint` | String | unique |
| `p256dh` | String | encryption key |
| `auth` | String | auth secret |
| `userAgent` | String? | — |

### MLTrainingSample
Feature vectors + labels auto-collected on each photo analysis.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `plantId` | String | FK → Plant (cascade delete) |
| `sampledAt` | DateTime | timestamp of the reading snapshot |
| `features` | String | JSON-serialised `MLFeatures` |
| `label` | Float | 0–100 health label (from photo `healthScore`) |
| `labelSource` | String | `photo` (default), `manual` |
| `photoId` | String? | originating PlantPhoto id |
| `prediction` | Float? | model prediction at collection time |

Index: `(plantId, sampledAt)`

### MLModelVersion
Persists trained weight sets with performance metrics and rollback support.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `version` | String | unique; format `v{timestamp}` |
| `trainedAt` | DateTime | auto |
| `sampleCount` | Int | number of samples used |
| `weights` | String | JSON `{sensor, visual, weather, llm}` |
| `metrics` | String? | JSON `{rmse, mae, epochs}` |
| `isActive` | Boolean | only one active at a time (default false) |

### PairingCode ⚠️ NOT YET IMPLEMENTED
Required by Constitution §I and spec R1. Must be added in a follow-up migration.

| Field | Type | Constraints |
|---|---|---|
| `id` | String (cuid) | PK |
| `code` | String | 6–8 alphanumeric, unique |
| `deviceSerial` | String | the device claiming this code |
| `resolvedToken` | String? | set after firmware calls `/api/devices/pair/resolve` |
| `expiresAt` | DateTime | now + 15 minutes |
| `usedAt` | DateTime? | set on first successful use; subsequent uses rejected |
| `createdAt` | DateTime | auto |

Implementation notes:
- `POST /api/devices/pair` — generates a `PairingCode`, returns `{ code, expiresAt }` to the web UI.
- `POST /api/devices/pair/resolve` — firmware submits the code; server validates (not expired, not used), generates a device token, bcrypt-hashes it → `Device.tokenHash`, marks `PairingCode.usedAt`.
- Rate limiting: max 5 failed `/api/devices/pair/resolve` attempts per IP per minute; failure MUST NOT reveal code existence.

---

## Entity relationships

```
PairingCode  (standalone — links deviceSerial before Device.tokenHash is set)
Device (1) ──── (N) Plant (1) ──── (N) Reading
                         │
                         ├── (N) PlantPhoto ──generates──> MLTrainingSample
                         ├── (N) CalendarEvent
                         ├── (N) Alert
                         ├── (N) Memory       (includes ai_insights_cache)
                         ├── (N) ChatMessage
                         └── (N) MLTrainingSample

PushSubscription   (standalone, no FK)
MLModelVersion     (standalone, global active flag)
```

---

## State transitions

### CalendarEvent.status
```
planned → done
planned → skipped
```

### MLModelVersion.isActive
Only one row may have `isActive = true`. When a new version is trained, all previous versions are set to `isActive = false` atomically (Prisma transaction).

---

## Remaining Work (gaps vs spec)

| Gap | What's Missing | Spec Ref |
|---|---|---|
| `PairingCode` model | Not in schema.prisma; no migration | R1 / Constitution §I |
| `POST /api/devices/pair` | Pairing code generation endpoint | R1 |
| `POST /api/devices/pair/resolve` | Firmware token resolution endpoint + rate limiting | R1 |
| Pairing UI | Web UI flow for code display + device status | R1 |
| Unpair UI | Web UI to unlink device without data loss | R1 |

These gaps MUST be resolved before this branch can be merged per Constitution §I.

---

### PlantPhoto.confidence
Set by LLM response parsing. If the LLM returns no confidence value, defaults to 0, which causes `computeVisualScore` to fall back to the 50-point neutral prior.
