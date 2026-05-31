# Arborisis Pico WH firmware

MicroPython firmware for Raspberry Pi Pico WH + Grove Shield for Pi Pico v1.

## What's new in 0.2.0

- **Hardware watchdog** (`WDT`, ~8 s) auto-recovers from hangs; the main loop is
  wrapped so a single bad cycle never bricks the device.
- **Offline buffering**: up to `OFFLINE_BUFFER_MAX` readings are cached in RAM
  while the API is unreachable and flushed (oldest-first) once it returns. 4xx
  responses (bad token / validation) are dropped instead of retried forever.
- **NTP time sync** stamps each reading with an ISO-8601 `recordedAt`, improving
  server-side idempotency `(deviceSerial, recordedAt)`. Re-syncs every 6 h.
- **Median-filtered ADC** for soil moisture and battery to reject sampling noise.
- **TSL2561 auto-gain** with saturation handling for a much wider lux range.
- **Wi-Fi reconnect with capped exponential backoff** instead of busy-looping.
- **Status LED**: blinks while associating, solid in setup mode, double-blink
  heartbeat each successful cycle.
- **Diagnostics**: `gc.collect()` each cycle plus a `GET /api/diagnostics`
  endpoint and a richer local dashboard (uptime, queue depth, POST counters,
  free RAM, clock status, battery %).

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

## Battery monitoring (optional)

Set `BATTERY_ADC_PIN = 29` in `config.py` to read VSYS through the Pico's
internal 3:1 divider (keep `BATTERY_DIVIDER = 3.0`). The dashboard then shows a
battery percentage derived from `BATTERY_EMPTY_MV`/`BATTERY_FULL_MV`.

## Calibration

`moisture_dry_raw` and `moisture_wet_raw` are stored in `arborisis_config.json`.
Use the serial console to read raw values in dry air and wet soil/water, then update the setup file.

## BLE

`ble_service.py` is optional. It requires `aioble`, which is not always bundled by default.
The primary iPhone-compatible path is Wi-Fi telemetry to the PWA.
