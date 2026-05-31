FIRMWARE_VERSION = "0.2.0"

DEVICE_NAME_PREFIX = "Arborisis"
DEFAULT_SAMPLE_SECONDS = 45

# Regulatory domain for the Wi-Fi radio (affects allowed channels / TX power).
COUNTRY = "BE"

I2C_ID = 0
I2C_SDA_PIN = 8
I2C_SCL_PIN = 9
I2C_FREQ = 100000

LIGHT_I2C_ID = 1
LIGHT_I2C_SDA_PIN = 6
LIGHT_I2C_SCL_PIN = 7

SOIL_MOISTURE_ADC_PIN = 26
SOIL_TEMP_ONEWIRE_PIN = 18

# Battery monitoring is optional. On a bare Pico WH, VSYS is exposed on GP29
# (ADC3) through an internal 3:1 divider, so keep BATTERY_DIVIDER = 3.0 there.
BATTERY_ADC_PIN = None
BATTERY_DIVIDER = 3.0
BATTERY_FULL_MV = 4200
BATTERY_EMPTY_MV = 3300

# Onboard LED. "LED" is the portable alias for the Pico W/WH status LED.
STATUS_LED_PIN = "LED"

# Reliability tuning.
WATCHDOG_MS = 8000            # RP2040 hardware watchdog ceiling is ~8.3 s.
WIFI_CONNECT_TIMEOUT = 18     # seconds to wait for an association.
WIFI_BACKOFF_START = 5        # seconds before the first reconnect attempt.
WIFI_BACKOFF_MAX = 300        # cap on the exponential reconnect backoff.
OFFLINE_BUFFER_MAX = 60       # readings cached in RAM while the API is down.
NTP_HOST = "pool.ntp.org"
NTP_RESYNC_SECONDS = 21600    # re-sync the clock every 6 h.

# Median filtering smooths noisy ADC channels (odd sample counts only).
MOISTURE_SAMPLES = 9
BATTERY_SAMPLES = 5

# Access-point fallback used during provisioning.
AP_PASSWORD = "arborisis"

CONFIG_FILE = "arborisis_config.json"

DEFAULT_CONFIG = {
    "ssid": "",
    "password": "",
    "api_url": "http://192.168.1.10:3000/api/telemetry",
    "device_token": "change-me-device-token",
    "sample_seconds": DEFAULT_SAMPLE_SECONDS,
    "moisture_dry_raw": 52000,
    "moisture_wet_raw": 22000
}
