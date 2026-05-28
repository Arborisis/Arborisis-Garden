import json
import socket
import time
import ubinascii

import machine
import network
from machine import ADC, I2C, Pin

import config
from drivers.bme280 import BME280
from drivers.tsl2561 import TSL2561

try:
    import urequests as requests
except ImportError:
    requests = None

try:
    import onewire
    import ds18x20
except ImportError:
    onewire = None
    ds18x20 = None


class ArborisisPico:
    def __init__(self):
        self.device_serial = ubinascii.hexlify(machine.unique_id()).decode()
        self.device_name = "{}-{}".format(config.DEVICE_NAME_PREFIX, self.device_serial[-6:])
        self.settings = self.load_config()
        self.adc = ADC(Pin(config.SOIL_MOISTURE_ADC_PIN))
        self.battery_adc = ADC(Pin(config.BATTERY_ADC_PIN)) if config.BATTERY_ADC_PIN is not None else None
        self.i2c = I2C(
            config.I2C_ID,
            sda=Pin(config.I2C_SDA_PIN),
            scl=Pin(config.I2C_SCL_PIN),
            freq=config.I2C_FREQ
        )
        self.light_i2c = I2C(
            config.LIGHT_I2C_ID,
            sda=Pin(config.LIGHT_I2C_SDA_PIN),
            scl=Pin(config.LIGHT_I2C_SCL_PIN),
            freq=config.I2C_FREQ
        )
        self.bme = self.safe_sensor("BME280", lambda: BME280(self.i2c))
        self.light = self.safe_sensor("TSL2561", lambda: TSL2561(self.light_i2c))
        self.ds = None
        self.ds_roms = []
        self.web_server = None
        self.latest_payload = {}
        if onewire and ds18x20:
            self.ds = ds18x20.DS18X20(onewire.OneWire(Pin(config.SOIL_TEMP_ONEWIRE_PIN)))
            self.ds_roms = self.ds.scan()
        self.wlan = network.WLAN(network.STA_IF)

    def safe_sensor(self, label, factory):
        try:
            sensor = factory()
            print(label, "ready")
            return sensor
        except Exception as exc:
            print(label, "disabled:", exc)
            return None

    def load_config(self):
        data = dict(config.DEFAULT_CONFIG)
        try:
            with open(config.CONFIG_FILE, "r") as handle:
                data.update(json.load(handle))
        except Exception:
            pass
        return data

    def save_config(self):
        with open(config.CONFIG_FILE, "w") as handle:
            json.dump(self.settings, handle)

    def moisture_percent(self, raw):
        dry = int(self.settings.get("moisture_dry_raw", config.DEFAULT_CONFIG["moisture_dry_raw"]))
        wet = int(self.settings.get("moisture_wet_raw", config.DEFAULT_CONFIG["moisture_wet_raw"]))
        if dry == wet:
            return None
        pct = (dry - raw) * 100 / (dry - wet)
        return max(0, min(100, pct))

    def read_soil_temp(self):
        if not self.ds or not self.ds_roms:
            return None
        self.ds.convert_temp()
        time.sleep_ms(760)
        return self.ds.read_temp(self.ds_roms[0])

    def read_battery_mv(self):
        if not self.battery_adc:
            return None
        return int(self.battery_adc.read_u16() * 3300 / 65535)

    def read_payload(self):
        raw = self.adc.read_u16()
        payload = {
            "deviceSerial": self.device_serial,
            "deviceName": self.device_name,
            "firmwareVersion": config.FIRMWARE_VERSION,
            "soilMoistureRaw": raw,
            "soilMoisturePct": self.moisture_percent(raw),
            "soilTempC": self.read_soil_temp(),
            "batteryMv": self.read_battery_mv()
        }
        if self.wlan.active() and self.wlan.isconnected():
            payload["wifiRssi"] = self.wlan.status("rssi")
        if self.bme:
            payload.update(self.bme.read())
        if self.light:
            payload["lightLux"] = self.light.read_lux()
        return {key: value for key, value in payload.items() if value is not None}

    def connect_wifi(self):
        ssid = self.settings.get("ssid", "")
        if not ssid:
            return False
        self.wlan.active(True)
        if not self.wlan.isconnected():
            print("Connecting Wi-Fi:", ssid)
            self.wlan.connect(ssid, self.settings.get("password", ""))
            deadline = time.time() + 18
            while time.time() < deadline and not self.wlan.isconnected():
                time.sleep(1)
        print("Wi-Fi:", self.wlan.ifconfig() if self.wlan.isconnected() else "offline")
        return self.wlan.isconnected()

    def post_payload(self, payload):
        if requests is None:
            print("urequests missing")
            return False
        headers = {
            "Content-Type": "application/json",
            "X-Device-Token": self.settings.get("device_token", "")
        }
        try:
            response = requests.post(self.settings["api_url"], data=json.dumps(payload), headers=headers)
            print("POST", response.status_code, response.text[:120])
            response.close()
            return 200 <= response.status_code < 300
        except Exception as exc:
            print("POST failed:", exc)
            return False

    def start_web_server(self):
        if self.web_server:
            return
        try:
            server = socket.socket()
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("0.0.0.0", 80))
            server.listen(1)
            server.setblocking(False)
            self.web_server = server
            print("Local web server ready on http://{}/".format(self.wlan.ifconfig()[0]))
        except Exception as exc:
            print("Local web server disabled:", exc)
            self.web_server = None

    def handle_web_once(self):
        if not self.web_server:
            return
        try:
            client, _ = self.web_server.accept()
        except OSError:
            return

        try:
            request = client.recv(2048).decode()
            path = request.split(" ", 2)[1] if request else "/"
            if path.startswith("/api/readings"):
                body = json.dumps(self.latest_payload or self.read_payload())
                client.send("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n")
                client.send(body)
            else:
                body = self.dashboard_page(self.latest_payload or self.read_payload())
                client.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: no-store\r\n\r\n")
                client.send(body)
        except Exception as exc:
            print("Web request failed:", exc)
        finally:
            client.close()

    def dashboard_page(self, payload):
        def value(key, unit=""):
            raw = payload.get(key)
            if raw is None:
                return "--"
            if isinstance(raw, float):
                raw = round(raw, 1)
            return "{}{}".format(raw, unit)

        return """<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Arborisis Pico</title>
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#f6f8f4;color:#17231f}}
main{{max-width:620px;margin:auto;padding:18px}}
h1{{font-size:34px;line-height:1;margin:6px 0 16px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.card{{background:white;border:1px solid #dbe4df;border-radius:8px;padding:14px;min-height:86px}}
.label{{color:#63716b;font-size:13px}} .value{{font-size:25px;font-weight:800;margin-top:8px}}
.wide{{grid-column:1/-1}} code{{word-break:break-all}}
</style></head><body><main>
<div class="label">Arborisis Pico local</div><h1>{name}</h1>
<section class="grid">
<div class="card"><div class="label">Humidite sol</div><div class="value">{moisture}</div></div>
<div class="card"><div class="label">Temp. sol</div><div class="value">{soil_temp}</div></div>
<div class="card"><div class="label">Air</div><div class="value">{air_temp}</div></div>
<div class="card"><div class="label">Humidite air</div><div class="value">{air_humidity}</div></div>
<div class="card"><div class="label">Lumiere</div><div class="value">{light}</div></div>
<div class="card"><div class="label">Wi-Fi RSSI</div><div class="value">{rssi}</div></div>
<div class="card wide"><div class="label">API locale</div><div><code>/api/readings</code></div></div>
</section></main></body></html>""".format(
            name=self.device_name,
            moisture=value("soilMoisturePct", "%"),
            soil_temp=value("soilTempC", " C"),
            air_temp=value("airTempC", " C"),
            air_humidity=value("airHumidityPct", "%"),
            light=value("lightLux", " lx"),
            rssi=value("wifiRssi", " dBm")
        )

    def setup_ap(self):
        try:
            network.country("BE")
        except Exception:
            pass
        ap = network.WLAN(network.AP_IF)
        ap.active(True)
        ap.config(essid=self.device_name, password="arborisis", channel=6)
        ap.ifconfig(("192.168.4.1", "255.255.255.0", "192.168.4.1", "8.8.8.8"))
        time.sleep(2)
        print("Setup AP:", self.device_name, "password arborisis", ap.ifconfig(), "active", ap.active())
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("0.0.0.0", 80))
        server.listen(1)
        page = self.setup_page()
        while True:
            client, _ = server.accept()
            request = self.read_http_request(client)
            if request.startswith("POST /save"):
                body = request.split("\r\n\r\n", 1)[-1]
                updated = self.parse_form(body)
                if not updated.get("ssid"):
                    self.send_html(client, self.setup_page("Le nom du Wi-Fi est obligatoire."))
                    client.close()
                    continue
                self.settings.update(updated)
                self.save_config()
                self.send_html(client, "<h1>Saved</h1><p>Configuration sauvegardee. Redemarrage...</p>")
                client.close()
                time.sleep(2)
                machine.reset()
            else:
                self.send_html(client, page)
                client.close()

    def read_http_request(self, client):
        request = client.recv(2048)
        if not request:
            return ""
        request_text = request.decode()
        headers, _, body = request_text.partition("\r\n\r\n")
        content_length = 0
        for line in headers.split("\r\n"):
            if line.lower().startswith("content-length:"):
                try:
                    content_length = int(line.split(":", 1)[1].strip())
                except Exception:
                    content_length = 0
        while len(body) < content_length:
            chunk = client.recv(1024)
            if not chunk:
                break
            body += chunk.decode()
        return headers + "\r\n\r\n" + body

    def send_html(self, client, body):
        if not body.startswith("<!doctype"):
            body = "<!doctype html><html><body>{}</body></html>".format(body)
        response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "Content-Length: {}\r\n"
            "Connection: close\r\n\r\n{}"
        ).format(len(body), body)
        client.send(response)

    def setup_page(self, error=""):
        error_html = "<p style='color:#b42318'>{}</p>".format(error) if error else ""
        return """<!doctype html><html><body>
<h1>Arborisis Pico setup</h1>
{error}
<form method="post" action="/save">
<input name="ssid" placeholder="Wi-Fi SSID" value="{ssid}" required><br>
<input name="password" placeholder="Wi-Fi password" type="password" value="{password}"><br>
<input name="api_url" placeholder="API URL" value="{api_url}"><br>
<input name="device_token" placeholder="Device token" value="{token}"><br>
<button>Save</button>
</form></body></html>""".format(
            error=error_html,
            ssid=self.settings.get("ssid", ""),
            password=self.settings.get("password", ""),
            api_url=self.settings.get("api_url", ""),
            token=self.settings.get("device_token", "")
        )

    def url_decode(self, value):
        value = value.replace("+", " ")
        parts = value.split("%")
        decoded = parts[0]
        for part in parts[1:]:
            if len(part) >= 2:
                try:
                    decoded += chr(int(part[:2], 16)) + part[2:]
                    continue
                except Exception:
                    pass
            decoded += "%" + part
        return decoded

    def parse_form(self, body):
        updated = {}
        for part in body.split("&"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            if key in self.settings:
                updated[key] = self.url_decode(value)
        return updated

    def run(self):
        if not self.connect_wifi():
            self.setup_ap()
        while True:
            payload = self.read_payload()
            self.latest_payload = payload
            print(json.dumps(payload))
            if not self.post_payload(payload):
                self.connect_wifi()
            self.start_web_server()
            for _ in range(int(self.settings.get("sample_seconds", config.DEFAULT_SAMPLE_SECONDS))):
                self.handle_web_once()
                time.sleep(1)


app = ArborisisPico()
app.run()
