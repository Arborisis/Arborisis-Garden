FIRMWARE_VERSION = "0.1.0"

DEVICE_NAME_PREFIX = "Arborisis"
DEFAULT_SAMPLE_SECONDS = 45

I2C_ID = 0
I2C_SDA_PIN = 8
I2C_SCL_PIN = 9
I2C_FREQ = 100000

LIGHT_I2C_ID = 1
LIGHT_I2C_SDA_PIN = 6
LIGHT_I2C_SCL_PIN = 7

SOIL_MOISTURE_ADC_PIN = 26
SOIL_TEMP_ONEWIRE_PIN = 18
BATTERY_ADC_PIN = None

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
