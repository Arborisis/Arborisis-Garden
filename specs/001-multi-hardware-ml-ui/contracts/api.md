# API Contracts: 001-multi-hardware-ml-ui

All endpoints are relative to the app root. All request/response bodies are `application/json` unless noted. All write endpoints require a valid device token (`X-Device-Token` header) or a valid session — see Constitution §II.

---

## ML Endpoints

### `GET /api/ml/predict`

Returns a health prediction for the given plant.

**Query params**
| Param | Required | Description |
|---|---|---|
| `plantId` | yes | CUID of the plant |
| `weatherLocation` | no | `"City, Country"` string for weather enrichment |
| `timezone` | no | IANA timezone string (e.g. `Europe/Brussels`) |

**Response 200**
```json
{
  "prediction": {
    "healthScore": 72,
    "stressLevel": "watch",
    "wateringUrgencyHours": 18,
    "confidenceScore": 0.61,
    "breakdown": {
      "sensorScore": 68,
      "visualScore": 80,
      "weatherRisk": 35,
      "llmConsensus": 75
    },
    "dominantSignals": ["Humidité sol", "Analyse visuelle", "Météo"],
    "generatedAt": "2026-05-30T12:00:00.000Z"
  },
  "modelVersion": { "version": "v1748608800000", "trainedAt": "...", "sampleCount": 12 },
  "features": {
    "sensorFreshness": 0.95,
    "moisturePct": 38,
    "targetMoisturePct": 48,
    "moistureSlopePctPerHour": -0.6,
    "photoHealth": 0.78,
    "photoConfidence": 0.82
  },
  "lowConfidenceWarning": false
}
```

**Response 400** — missing/invalid `plantId`
**Response 404** — plant not found

---

### `POST /api/ml/collect`

Extracts features from current plant state and persists `MLTrainingSample` rows. Called automatically after photo analysis.

**Request body**
```json
{
  "plantId": "cuid...",
  "weatherLocation": "Brussels, Belgium",
  "timezone": "Europe/Brussels"
}
```

**Response 200**
```json
{
  "collected": 1,
  "plantId": "cuid...",
  "label": 78,
  "sampleId": "cuid..."
}
```

**Response 422** — no photo with health score found for this plant

---

### `GET /api/ml/train`

Returns all model versions.

**Response 200**
```json
{
  "versions": [
    {
      "version": "v1748608800000",
      "trainedAt": "2026-05-30T12:00:00.000Z",
      "sampleCount": 12,
      "isActive": true,
      "weights": { "sensor": 0.48, "visual": 0.31, "weather": 0.13, "llm": 0.08 },
      "metrics": { "rmse": 8.4, "mae": 6.1, "epochs": 30 }
    }
  ]
}
```

### `POST /api/ml/train`

Runs gradient-descent training and persists a new `MLModelVersion`.

**Request body**
```json
{
  "plantId": "cuid...",
  "epochs": 30
}
```
Both fields optional. `epochs` range: 5–100.

**Response 200**
```json
{
  "version": "v1748608800000",
  "weights": { "sensor": 0.48, "visual": 0.31, "weather": 0.13, "llm": 0.08 },
  "metrics": { "rmse": 8.4, "mae": 6.1, "epochs": 30 },
  "sampleCount": 12,
  "improvement": { "rmseDelta": -1.2, "maeDelta": -0.9 }
}
```
**Response 422** — fewer than 3 training samples available

---

## Photo Endpoints

### `POST /api/photos`

Uploads a photo, stores it in object storage, runs LLM visual analysis, and triggers ML sample collection.

**Request**: `multipart/form-data`
| Field | Required | Description |
|---|---|---|
| `plantId` | yes | plant CUID |
| `file` | yes | image file (jpeg or png, max 10 MB) |
| `title` | no | custom title |
| `takenAt` | no | ISO 8601 datetime |

**Response 201**
```json
{
  "id": "cuid...",
  "plantId": "cuid...",
  "title": "Feuilles 30/05",
  "imageUrl": "/api/photos/image/plants%2Fcuid%2Fuuid.jpg",
  "healthScore": 75,
  "confidence": 0.82,
  "analysis": "Feuilles bien développées, légère chlorose sur...",
  "observations": ["Couleur vert clair", "Légère chlorose"],
  "recommendations": ["Apporter un engrais foliaire", "Augmenter l'humidité"],
  "createdAt": "2026-05-30T12:00:00.000Z"
}
```

### `GET /api/photos`

**Query params**: `plantId` (required)

**Response 200**
```json
{
  "photos": [ /* array of photo objects as above */ ]
}
```

### `GET /api/photos/image/[key]`

Streams the raw image binary from object storage.

**Response 200** — `Content-Type: image/jpeg` or `image/png`
**Response 404** — key not found

---

## Calendar Endpoints

### `GET /api/calendar`

**Query params**: `plantId` (required), `status` (optional, default `planned`)

**Response 200**
```json
{
  "events": [
    {
      "id": "cuid...",
      "plantId": "cuid...",
      "title": "Arrosage",
      "description": null,
      "startsAt": "2026-06-01T08:00:00.000Z",
      "endsAt": null,
      "category": "water",
      "priority": "high",
      "status": "planned",
      "source": "ai",
      "createdAt": "2026-05-30T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/calendar`

**Request body**
```json
{
  "plantId": "cuid...",
  "title": "Arrosage",
  "startsAt": "2026-06-01T08:00:00.000Z",
  "category": "water",
  "priority": "high"
}
```

**Response 201** — created event object

### `PATCH /api/calendar`

**Query params**: `eventId` (required)

**Request body**
```json
{ "status": "done" }
```

**Response 200** — updated event object

---

## Weather Endpoint

### `GET /api/weather`

**Query params**: `location` (required, e.g. `Brussels, Belgium`), `timezone` (optional)

**Response 200**
```json
{
  "current": {
    "tempC": 18.4,
    "humidity": 72,
    "rainProbability": 0.3,
    "uvIndex": 4,
    "windSpeedMs": 3.2,
    "description": "Partly cloudy"
  },
  "forecast": [
    { "date": "2026-05-31", "maxTempC": 21, "minTempC": 13, "rainMm": 2.1, "uvIndex": 5 }
  ],
  "et0": 3.8
}
```

---

## Insights Endpoint

### `GET /api/insights`

**Query params**: `plantId` (required), `weatherLocation` (optional), `timezone` (optional)

**Response 200**
```json
{
  "insights": [
    { "title": "Humidité optimale", "body": "Le niveau d'humidité est...", "tone": "good" },
    { "title": "Surveiller l'arrosage", "body": "La tendance à la baisse...", "tone": "watch" }
  ],
  "cached": true,
  "generatedAt": "2026-05-30T10:00:00.000Z",
  "expiresAt": "2026-05-30T14:00:00.000Z",
  "weatherIncluded": true
}
```

---

## Push Endpoints

### `POST /api/push/subscribe`

**Request body** — W3C PushSubscription JSON:
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": { "p256dh": "...", "auth": "..." }
}
```

**Response 200** — `{ "ok": true }`

### `DELETE /api/push/subscribe`

**Request body**: `{ "endpoint": "https://..." }`

**Response 200** — `{ "ok": true }`

### `POST /api/push/notify`

Internal endpoint (called by alert pipeline).

**Request body**
```json
{
  "title": "Arrosage urgent",
  "body": "Humidité à 22% — en-dessous du seuil critique",
  "url": "/",
  "tag": "alert-cuid"
}
```

**Response 200** — `{ "sent": 3, "failed": 0 }`

---

## Calibration Endpoint

### `POST /api/plants/calibrate`

Updates per-plant ADC calibration values.

**Request body**
```json
{
  "plantId": "cuid...",
  "moistureDryRaw": 52000,
  "moistureWetRaw": 22000
}
```

**Response 200** — updated plant object (fields: `moistureDryRaw`, `moistureWetRaw`, `targetMoisture`)
**Response 400** — invalid/missing fields
