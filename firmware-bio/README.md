# Arborisis Bio — firmware du 2e Pico (bioélectricité)

Firmware MicroPython **autonome** pour un **second** Raspberry Pi Pico W/WH +
Grove Shield for Pi Pico, dédié à la mesure du **biopotentiel** d'une plante
(électrophysiologie). Il s'installe sur un Pico distinct du firmware
environnemental (`firmware/`) et POST ses fenêtres vers `/api/bioelectric`.

Côté serveur, les lectures sont rattachées **automatiquement** à la plante du
Pico environnemental le plus récemment actif, puis analysées sur le long terme
pour détecter si la plante **réagit** (p. ex. à l'arrosage).

## ⚠️ Le signal est minuscule — il faut un étage d'amplification

Le biopotentiel d'une plante est de l'ordre du **µV au mV**, lent (mHz à quelques
Hz). L'ADC du Pico (12 bits effectifs, 0–3,3 V) ne peut pas le lire en direct :
il faut un **front-end analogique** entre les électrodes et `A0`. Ce firmware est
**générique** : il lit une voie déjà amplifiée et convertit en µV seulement si tu
lui donnes le gain (sinon il travaille en relatif sur les comptes bruts, ce qui
reste exploitable pour détecter des variations et des réactions).

### Électrodes
- 1 électrode de mesure dans/contre la **tige** (ou pétiole) — inox, Ag/AgCl, ou
  pince/patch conducteur.
- 1 électrode de **référence** dans le **substrat** (sol).
- Option : 3e électrode (sol) en *driven-right-leg* si le front-end le permet.

### Front-ends possibles (au choix)
| Montage | Branchement | `bio_gain` indicatif |
|---|---|---|
| **AD8232** (front-end ECG/biopotentiel) | sortie `OUTPUT` → `A0` (GP26), biais mi-rail intégré | ~1100 |
| **Grove EMG / capteur musculaire** | connecteur Grove analogique → `A0` | dépend du module |
| **Ampli maison INA333 / AD620** | électrodes → ampli (gain réglé), sortie biaisée à 1,65 V → `A0` | celui que tu règles |

Quel que soit le montage : sortie **biaisée à ~1,65 V** (mi-rail) pour capter les
deux polarités, câbles **courts et si possible blindés**, alimentation propre.

### Mode électrodes directes (sans ampli) — auto-calibration temps réel
Tu peux brancher les électrodes **directement** sur l'entrée analogique, sans
étage de gain. Dans ce cas :

- **Câblage Grove** : électrode de mesure → **signal A0 (fil jaune = GP26)**,
  électrode de référence → **GND (fil noir)**. ⚠️ **Ne branche jamais une
  électrode sur le fil rouge (VCC 3,3 V)** : tu injecterais 3,3 V et l'entrée
  serait saturée. Laisse le fil rouge débranché.
- **Garde `bio_gain = 0`** : aucune calibration manuelle. Le firmware recale la
  baseline DC à chaque fenêtre (`bio_bias_raw = 0` ⇒ médiane auto) et le serveur
  normalise l'activité en continu sur la baseline récente de la plante → la
  **calibration se fait en temps réel**, rien à saisir.
- **Sur-échantillonnage** (`bio_oversample`, défaut 8) : l'entrée est haute
  impédance ; on moyenne plusieurs lectures par échantillon pour laisser le
  condensateur d'échantillonnage de l'ADC se charger et réduire le bruit.
- **Détection d'électrode flottante** : si l'entrée colle à un rail, le
  `qualityFlag` passe à `floating` (affiché dans le panneau, avec un rappel de
  câblage) et la fenêtre est exclue des décisions de réaction.
- **Limites honnêtes** : sans ampli, le vrai signal µV de la plante est sous le
  plancher de bruit de l'ADC, et le **secteur 50 Hz** se couple fortement. On
  mesure surtout le **potentiel relatif et ses variations lentes** — utile pour
  des tendances/réactions, pas pour de l'électrophysiologie en µV absolus.
  Un simple buffer (op-amp suiveur) + filtre RC, ou un AD8232, améliorerait
  nettement. Abaisser `sample_rate_hz` (ex. 32–64 Hz) aide aussi.

## Câblage
- Grove Shield power switch : **3.3V**.
- Voie bio : analogique `A0`, Pico `GP26` (`BIO_ADC_PIN`).
- (Optionnel) batterie : `GP29` / ADC3 via diviseur interne 3:1 (`BATTERY_ADC_PIN = 29`).

## Premier démarrage
1. Flashe le dernier UF2 MicroPython pour Raspberry Pi Pico W/WH.
2. Copie `config.py`, `main.py`, `biosignal.py` sur le Pico.
3. Sans Wi-Fi configuré, le Pico crée le réseau `ArborisisBio-*` (mot de passe `arborisis`).
4. Rejoins ce Wi-Fi, ouvre `http://192.168.4.1`, et renseigne :
   - SSID / mot de passe Wi-Fi.
   - **API URL**, p. ex. `http://TON_IP_MAC:3000/api/bioelectric`.
   - **Device token** = `DEVICE_INGEST_TOKEN` du serveur.
   - **Fréquence d'échantillonnage** (`sample_rate_hz`, défaut 128) et **durée de
     fenêtre** (`window_seconds`, défaut 4 s) — réglables ici sans reflasher.
   - **Gain** du front-end (`bio_gain`, `0` = inconnu), `bio_uv_per_count`
     (≈ 50,35 µV/compte à gain 1), et offset DC (`bio_bias_raw`, `0` = baseline auto).

## Dépannage Wi-Fi
- Le Pico W/WH se connecte uniquement aux réseaux **2,4 GHz**. Si ton routeur
  sépare 2,4 GHz et 5 GHz, choisis le SSID 2,4 GHz.
- Si tu ne vois pas `ArborisisBio-*`, redémarre le Pico sans fichier
  `arborisis_bio_config.json` ou avec `"ssid": ""` dans ce fichier.
- Pour configurer : connecte ton téléphone/ordinateur au Wi-Fi `ArborisisBio-*`
  avec le mot de passe `arborisis`, puis ouvre `http://192.168.4.1`.
- Si la connexion échoue après sauvegarde, ouvre la console série du Pico :
  le firmware affiche maintenant `wrong password`, `ssid not found` ou
  `connection failed` quand MicroPython fournit ce statut.
- Les SSID/mots de passe avec accents ou caractères UTF-8 sont acceptés par le
  formulaire de setup.

## Ce que le Pico calcule et envoie (par fenêtre)
`biosignal.analyze()` produit, sans FFT : `rmsRaw`, `stdRaw`, `p2pRaw`,
`min/maxRaw`, `slopeRawPerSec` (dérive), `zeroCrossRate`, `spikeCount`
(franchissements à ±`SPIKE_SIGMA`·σ), des énergies de bande
`bandLow/Mid/HighEnergy`, un `qualityFlag` (`ok` / `saturated` / `flatline` /
`noisy`), une `waveform` décimée (64 points 0–1), et `rmsUv`/`baselineUv` si le
gain est connu.

## Fiabilité (identique au firmware env)
- **Watchdog ~8 s** : l'acquisition se fait par paquets d'~1 s, le WDT est nourri
  entre les paquets — une fenêtre longue ne provoque jamais de reset.
- **Buffer offline** (RAM) + flush oldest-first ; 4xx jeté, 5xx/réseau rejoué.
- **NTP** : chaque fenêtre est horodatée (`recordedAt`) ; re-sync toutes les 6 h.
- **Wi-Fi** : reconnexion avec backoff exponentiel borné.
- **Dashboard local** : `http://<ip>/` (auto-refresh), plus `GET /api/readings`
  et `GET /api/diagnostics`.

## Calibration du gain (optionnelle mais recommandée)
1. Laisse `bio_gain = 0` au début : le serveur normalise l'activité en relatif.
2. Pour des µV absolus : mesure/lis le gain total du front-end et saisis-le dans
   `bio_gain`. Le firmware enverra alors aussi `rmsUv` et `baselineUv`.
3. `bio_bias_raw` à `0` laisse le firmware estimer la baseline (médiane de
   fenêtre) — pratique si la sortie n'est pas parfaitement centrée à mi-rail.
