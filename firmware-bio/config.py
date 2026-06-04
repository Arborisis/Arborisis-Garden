FIRMWARE_VERSION = "bio-0.1.0"

DEVICE_NAME_PREFIX = "ArborisisBio"
DEFAULT_SAMPLE_SECONDS = 45   # intervalle (s) entre deux fenetres d'acquisition.

# Regulatory domain for the Wi-Fi radio (affects allowed channels / TX power).
COUNTRY = "BE"

# --- Acquisition bioelectrique -------------------------------------------------
# Voie analogique DEJA amplifiee (sortie du front-end: AD8232 / Grove EMG / ampli
# d'instrumentation INA biaise a mi-rail). Le signal brut d'une plante est en uV;
# il DOIT passer par un etage de gain avant l'ADC du Pico.
BIO_ADC_PIN = 26              # A0 sur le Grove Shield for Pi Pico.
BIO_REF_ADC_PIN = None        # 2e voie differentielle optionnelle (non utilisee par defaut).

# Frequence d'echantillonnage et fenetre. 128 Hz x 4 s = 512 echantillons.
# Reglables aussi a chaud via la page de setup (sample_rate_hz / window_seconds).
SAMPLE_RATE_HZ = 128
WINDOW_SECONDS = 4
# Acquisition par paquets: le watchdog est nourri entre chaque paquet, donc une
# fenetre longue ne declenche jamais un reset (cf. firmware env, contrainte WDT).
CHUNK_SAMPLES = 128
# Nombre de points de la forme d'onde sous-echantillonnee envoyee au serveur.
WAVEFORM_POINTS = 64

# Conversion vers le uV refere-entree. Laisser BIO_GAIN = 0 (inconnu) tant que le
# gain du front-end n'est pas mesure: le serveur travaille alors en RELATIF sur les
# comptes bruts (toujours utile). 3300 mV / 65535 ~= 50.35 uV par compte a gain 1.
#
# MODE ELECTRODES DIRECTES (sans ampli, electrodes branchees direct sur A0):
#   garder BIO_GAIN = 0. Il n'y a aucun gain a calibrer: le firmware recale la
#   baseline DC a chaque fenetre (BIO_BIAS_RAW = 0 => mediane auto) et le serveur
#   normalise l'activite en continu sur la baseline RECENTE de la plante. La
#   calibration est donc faite EN TEMPS REEL, sans valeur a saisir a la main.
BIO_GAIN = 0                  # gain total du front-end (ex: 1000). 0 = inconnu / direct.
BIO_UV_PER_COUNT = 50.35      # uV/compte a gain unite (ADC 16 bits, ref 3.3 V).
BIO_BIAS_RAW = 0              # offset DC en comptes; 0 = baseline auto (mediane).

# Entree haute impedance (electrodes directes): l'ADC du RP2040 veut une source
# basse impedance. On moyenne BIO_OVERSAMPLE lectures par echantillon: la 1ere
# laisse se charger le condensateur d'echantillonnage, la moyenne reduit le bruit.
BIO_OVERSAMPLE = 8

# Detection locale de spikes: seuil = baseline +/- SPIKE_SIGMA * ecart-type.
SPIKE_SIGMA = 3.0

# Seuils de qualite du signal (comptes ADC 0-65535).
QUALITY_FLATLINE_P2P = 30     # pic-a-pic en dessous => "flatline".
QUALITY_NOISY_STD = 9000      # ecart-type au dessus => "noisy".
QUALITY_RAIL_MARGIN = 400     # a moins de N comptes d'un rail => candidat sature/flottant.
QUALITY_RAIL_FRACTION = 0.05  # fraction d'echantillons aux rails => "saturated".

# Battery monitoring optionnel (identique au firmware env: VSYS sur GP29 / ADC3).
BATTERY_ADC_PIN = None
BATTERY_DIVIDER = 3.0
BATTERY_FULL_MV = 4200
BATTERY_EMPTY_MV = 3300
BATTERY_SAMPLES = 5

# Onboard LED. "LED" is the portable alias for the Pico W/WH status LED.
STATUS_LED_PIN = "LED"

# Reliability tuning (memes valeurs que le firmware environnemental).
WATCHDOG_MS = 0               # 0 = disabled; network DNS/HTTPS can exceed RP2040 WDT ceiling.
WIFI_CONNECT_TIMEOUT = 18
WIFI_CONNECT_ATTEMPTS = 3
WIFI_BACKOFF_START = 5
WIFI_BACKOFF_MAX = 300
OFFLINE_BUFFER_MAX = 60
HTTP_TIMEOUT = 6              # < WATCHDOG_MS: un POST bloque est buffer puis reessaye.
NTP_HOST = "pool.ntp.org"
NTP_TIMEOUT = 2
NTP_RESYNC_SECONDS = 21600
NTP_RETRY_SECONDS = 600

# Access-point fallback used during provisioning.
AP_PASSWORD = "arborisis"

CONFIG_FILE = "arborisis_bio_config.json"

DEFAULT_CONFIG = {
    "ssid": "",
    "password": "",
    "api_url": "http://192.168.1.10:3000/api/bioelectric",
    "device_token": "change-me-device-token",
    "sample_seconds": DEFAULT_SAMPLE_SECONDS,
    "sample_rate_hz": SAMPLE_RATE_HZ,
    "window_seconds": WINDOW_SECONDS,
    "bio_gain": BIO_GAIN,
    "bio_uv_per_count": BIO_UV_PER_COUNT,
    "bio_bias_raw": BIO_BIAS_RAW,
    "bio_oversample": BIO_OVERSAMPLE
}
