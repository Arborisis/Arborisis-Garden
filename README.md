# Arborisis Garden

Compagnon IA pour plantes avec Raspberry Pi Pico WH, Grove Shield, capteurs Grove et PWA full stack.

## Demarrage app

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Ouvre `http://localhost:3000` depuis le Mac. Pour recevoir les donnees du Pico depuis le meme Wi-Fi, remplace `localhost` par l'adresse IP du Mac dans la configuration du Pico, par exemple `http://192.168.1.42:3000/api/telemetry`.

## Variables

- `DATABASE_URL`: SQLite local, defaut `file:./dev.db`.
- `DEVICE_INGEST_TOKEN`: token partage avec le Pico.
- `OPENROUTER_API_KEY`: active le vrai agent IA.
- `OPENROUTER_MODEL`: modele OpenRouter, defaut qualite dans `.env.example`.

## Firmware Pico

Le dossier `firmware/` contient le programme MicroPython. Copie `main.py`, `config.py`, `ble_service.py` et `drivers/` sur le Pico WH apres avoir flashe MicroPython pour Pico W/WH.

Au premier demarrage, le Pico cree un point d'acces `Arborisis-*`, mot de passe `arborisis`, puis expose une page setup sur `http://192.168.4.1`.

## API telemetry

```bash
curl -X POST http://localhost:3000/api/telemetry \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Token: change-me-device-token' \
  -d '{
    "deviceSerial": "pico-demo",
    "soilMoisturePct": 42,
    "soilTempC": 19.4,
    "airTempC": 22.1,
    "airHumidityPct": 55,
    "pressureHpa": 1013,
    "lightLux": 380
  }'
```
