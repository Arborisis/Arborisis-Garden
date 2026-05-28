# Arborisis Pico WH firmware

MicroPython firmware for Raspberry Pi Pico WH + Grove Shield for Pi Pico v1.

## Wiring

- Grove Shield power switch: 3.3V.
- Soil moisture: analog `A0`, Pico `GP26`.
- Soil temperature 1-Wire: digital `D18`, Pico `GP18`.
- BME280: `I2C0`, Pico `GP8` SDA and `GP9` SCL.
- Grove Digital Light Sensor TSL2561: `I2C1`, Pico `GP6` SDA and `GP7` SCL.

## First boot

1. Flash the latest MicroPython UF2 for Raspberry Pi Pico W/WH.
2. Copy `config.py`, `main.py`, `ble_service.py`, and the `drivers` folder to the Pico.
3. If no Wi-Fi is configured, the Pico creates `Arborisis-*` with password `arborisis`.
4. Join that Wi-Fi and open `http://192.168.4.1`.
5. Save:
   - Wi-Fi SSID/password.
   - API URL, for example `http://YOUR_MAC_IP:3000/api/telemetry`.
   - Device token matching `DEVICE_INGEST_TOKEN`.

## Calibration

`moisture_dry_raw` and `moisture_wet_raw` are stored in `arborisis_config.json`.
Use the serial console to read raw values in dry air and wet soil/water, then update the setup file.

## BLE

`ble_service.py` is optional. It requires `aioble`, which is not always bundled by default.
The primary iPhone-compatible path is Wi-Fi telemetry to the PWA.
