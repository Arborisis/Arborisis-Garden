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

## Nouvelles fonctionnalites (v0.1.1)

- **ML Intelligence**: pipeline 4-signaux (capteur, visuel, météo, LLM) avec gradient descent, versionnement et rollback du modèle
- **Photos**: stockage Railway Object Storage (S3), analyse LLM multimodale, collecte automatique d'échantillons ML
- **Calendrier**: événements de soin (arrosage, fertilisation, taille…) avec priorité et statut
- **Météo**: proxy Open-Meteo (gratuit, sans clé) avec ET₀ Penman-Monteith
- **Insights IA**: 1–4 conseils LLM en cache 4h, indexés par empreinte météo
- **Push notifications**: W3C Web Push VAPID, alertes critiques automatiques
- **Appairage appareils**: code 6 car. à usage unique, expiry 15 min, rate-limiting, token bcrypt

## Variables

- `DATABASE_URL`: URL PostgreSQL. En production Railway, utilise la reference `${{Postgres.DATABASE_URL}}`.
- `DEVICE_INGEST_TOKEN`: token partage avec le Pico.
- `OPENROUTER_API_KEY`: active le vrai agent IA.
- `OPENROUTER_MODEL`: modele OpenRouter, defaut qualite dans `.env.example`.
- `OPENROUTER_WEB_SEARCH_ENGINE`: moteur de recherche OpenRouter, defaut `auto` (`native`, `exa`, `firecrawl`, `parallel` possibles selon le compte).
- `OPENROUTER_WEB_SEARCH_MAX_RESULTS`: nombre maximal de resultats par recherche, defaut `5`.
- `OPENROUTER_WEB_SEARCH_MAX_TOTAL_RESULTS`: plafond total de resultats web par boucle agentique, defaut `10`.
- `OPENROUTER_WEB_SEARCH_CONTEXT_SIZE`: contexte web `low`, `medium` ou `high`.
- `STORAGE_ENDPOINT`: endpoint Railway Object Storage (S3-compatible).
- `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`: credentials S3 pour les photos.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: cles VAPID pour Web Push (generer avec `npx web-push generate-vapid-keys`).
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: cle publique VAPID exposee au client.
- `ML_AUTO_TRAIN_THRESHOLD`: nombre de nouveaux echantillons avant declenchement auto de l'entrainement (defaut `10`).

Pour le guide de setup complet, voir [specs/001-multi-hardware-ml-ui/quickstart.md](specs/001-multi-hardware-ml-ui/quickstart.md).

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
