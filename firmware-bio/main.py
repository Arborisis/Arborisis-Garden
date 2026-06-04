import gc
import json
import socket
import sys
import time
import ubinascii

import machine
import network
from machine import ADC, Pin, WDT

import config
import biosignal

try:
    import urequests as requests
except ImportError:
    requests = None


class ArborisisBioPico:
    def __init__(self):
        self.boot_ms = time.ticks_ms()
        self.device_serial = ubinascii.hexlify(machine.unique_id()).decode()
        self.device_name = "{}-{}".format(config.DEVICE_NAME_PREFIX, self.device_serial[-6:])
        self.settings = self.load_config()
        self.adc = ADC(Pin(config.BIO_ADC_PIN))
        self.battery_adc = ADC(Pin(config.BATTERY_ADC_PIN)) if config.BATTERY_ADC_PIN is not None else None
        self.led = self.init_led()
        self.web_server = None
        self.latest_payload = {}
        self.last_features = {}
        self.queue = []            # readings buffered while offline (oldest first).
        self.dropped_count = 0
        self.post_ok_count = 0
        self.post_fail_count = 0
        self.last_post = "never"
        self.time_synced = False
        self.last_sync_ms = None
        self.last_sync_attempt_ms = None
        self.wifi_backoff = config.WIFI_BACKOFF_START
        self.wlan = network.WLAN(network.STA_IF)
        self.wdt = None  # armed in run(), after slow boot work.

    # -- infrastructure helpers ------------------------------------------------

    def init_led(self):
        try:
            return Pin(config.STATUS_LED_PIN, Pin.OUT)
        except Exception:
            return None

    def led_set(self, on):
        if self.led:
            try:
                self.led.value(1 if on else 0)
            except Exception:
                pass

    def feed(self):
        if self.wdt:
            self.wdt.feed()

    def sleep(self, seconds):
        # WDT-safe sleep: feed the watchdog while we wait.
        end = time.ticks_add(time.ticks_ms(), int(seconds * 1000))
        while time.ticks_diff(end, time.ticks_ms()) > 0:
            self.feed()
            time.sleep_ms(200)

    def heartbeat(self):
        for _ in range(2):
            self.led_set(True)
            time.sleep_ms(40)
            self.led_set(False)
            time.sleep_ms(80)

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

    # Les valeurs venant de la page setup sont des chaines; on coerce a l'usage.
    def cfg_int(self, key, default):
        try:
            return int(float(self.settings.get(key, default)))
        except Exception:
            return default

    def cfg_float(self, key, default):
        try:
            return float(self.settings.get(key, default))
        except Exception:
            return default

    # -- sensor reads ----------------------------------------------------------

    def read_battery_mv(self):
        if not self.battery_adc:
            return None
        readings = []
        for _ in range(max(1, config.BATTERY_SAMPLES)):
            readings.append(self.battery_adc.read_u16())
            time.sleep_ms(3)
        readings.sort()
        raw = readings[len(readings) // 2]
        return int(raw * 3300 / 65535 * config.BATTERY_DIVIDER)

    def read_payload(self):
        rate = self.cfg_int("sample_rate_hz", config.SAMPLE_RATE_HZ)
        window = self.cfg_float("window_seconds", config.WINDOW_SECONDS)
        total = max(1, int(rate * window))
        # Borne le paquet a ~1 s de signal pour rester loin de la fenetre du WDT.
        chunk = max(1, min(config.CHUNK_SAMPLES, int(rate)))
        bias_cfg = self.cfg_int("bio_bias_raw", 0)
        bias = bias_cfg if bias_cfg > 0 else None
        oversample = self.cfg_int("bio_oversample", config.BIO_OVERSAMPLE)

        samples = biosignal.sample_window(self.adc, rate, total, chunk, self.feed, oversample)
        feats = biosignal.analyze(
            samples, rate, bias, config.SPIKE_SIGMA, config.WAVEFORM_POINTS,
            config.QUALITY_FLATLINE_P2P, config.QUALITY_NOISY_STD,
            config.QUALITY_RAIL_MARGIN, config.QUALITY_RAIL_FRACTION
        )
        self.last_features = feats

        payload = {
            "deviceSerial": self.device_serial,
            "deviceName": self.device_name,
            "firmwareVersion": config.FIRMWARE_VERSION,
            "sampleRateHz": rate,
            "windowSeconds": window,
            "sampleCount": feats.get("sampleCount", total),
            "channel": "A0",
            "baselineRaw": feats.get("baselineRaw"),
            "rmsRaw": feats.get("rmsRaw"),
            "stdRaw": feats.get("stdRaw"),
            "p2pRaw": feats.get("p2pRaw"),
            "minRaw": feats.get("minRaw"),
            "maxRaw": feats.get("maxRaw"),
            "slopeRawPerSec": feats.get("slopeRawPerSec"),
            "spikeCount": feats.get("spikeCount"),
            "zeroCrossRate": feats.get("zeroCrossRate"),
            "bandLowEnergy": feats.get("bandLowEnergy"),
            "bandMidEnergy": feats.get("bandMidEnergy"),
            "bandHighEnergy": feats.get("bandHighEnergy"),
            "qualityFlag": feats.get("qualityFlag"),
            "waveform": feats.get("waveform")
        }

        gain = self.cfg_float("bio_gain", 0)
        if gain and gain > 0:
            uv_per_count = self.cfg_float("bio_uv_per_count", config.BIO_UV_PER_COUNT)
            rms_uv = biosignal.to_uv(feats.get("rmsRaw"), gain, uv_per_count)
            base_uv = biosignal.to_uv(feats.get("baselineRaw"), gain, uv_per_count)
            payload["gain"] = gain
            if rms_uv is not None:
                payload["rmsUv"] = round(rms_uv, 2)
            if base_uv is not None:
                payload["baselineUv"] = round(base_uv, 2)

        recorded_at = self.iso_timestamp()
        if recorded_at:
            payload["recordedAt"] = recorded_at
        if self.wlan.active() and self.wlan.isconnected():
            payload["wifiRssi"] = self.wlan.status("rssi")
        battery_mv = self.read_battery_mv()
        if battery_mv is not None:
            payload["batteryMv"] = battery_mv

        return {key: value for key, value in payload.items() if value is not None}

    # -- time ------------------------------------------------------------------

    def iso_timestamp(self):
        if not self.time_synced:
            return None
        y, mo, d, h, mi, s, _, _ = time.gmtime()
        return "{:04d}-{:02d}-{:02d}T{:02d}:{:02d}:{:02d}Z".format(y, mo, d, h, mi, s)

    def sync_time(self, force=False):
        if not self.wlan.isconnected():
            return
        now = time.ticks_ms()
        if not force:
            if self.time_synced and self.last_sync_ms is not None \
                    and time.ticks_diff(now, self.last_sync_ms) < config.NTP_RESYNC_SECONDS * 1000:
                return
            if not self.time_synced and self.last_sync_attempt_ms is not None \
                    and time.ticks_diff(now, self.last_sync_attempt_ms) < config.NTP_RETRY_SECONDS * 1000:
                return
        self.last_sync_attempt_ms = now
        try:
            import ntptime
            ntptime.host = config.NTP_HOST
            self.feed()
            ntptime.settime()
            self.time_synced = True
            self.last_sync_ms = time.ticks_ms()
            print("Time synced:", self.iso_timestamp())
        except Exception as exc:
            print("NTP sync failed:", exc)

    # -- networking ------------------------------------------------------------

    def connect_wifi(self):
        ssid = self.settings.get("ssid", "")
        if not ssid:
            return False
        try:
            network.country(config.COUNTRY)
        except Exception:
            pass
        self.wlan.active(True)
        if not self.wlan.isconnected():
            print("Connecting Wi-Fi:", ssid)
            try:
                self.wlan.connect(ssid, self.settings.get("password", ""))
            except Exception as exc:
                print("Wi-Fi connect error:", exc)
            deadline = time.ticks_add(time.ticks_ms(), config.WIFI_CONNECT_TIMEOUT * 1000)
            while time.ticks_diff(deadline, time.ticks_ms()) > 0 and not self.wlan.isconnected():
                self.feed()
                self.led_set(True)
                time.sleep_ms(250)
                self.led_set(False)
                time.sleep_ms(250)
        connected = self.wlan.isconnected()
        if connected:
            print("Wi-Fi:", self.wlan.ifconfig())
            self.wifi_backoff = config.WIFI_BACKOFF_START
            self.sync_time()
        else:
            print("Wi-Fi: offline")
        return connected

    def ensure_wifi(self):
        if self.wlan.isconnected():
            return True
        self.sleep(self.wifi_backoff)
        connected = self.connect_wifi()
        if not connected:
            self.wifi_backoff = min(self.wifi_backoff * 2, config.WIFI_BACKOFF_MAX)
        return connected

    def post_payload(self, payload):
        if requests is None:
            print("urequests missing")
            return "retry"
        headers = {
            "Content-Type": "application/json",
            "X-Device-Token": self.settings.get("device_token", "")
        }
        url = self.settings.get("api_url", "")
        if not url:
            return "drop"
        response = None
        try:
            self.feed()
            response = requests.post(url, data=json.dumps(payload), headers=headers, timeout=config.HTTP_TIMEOUT)
            status = response.status_code
            print("POST", status, response.text[:120])
            self.last_post = "HTTP {}".format(status)
            if 200 <= status < 300:
                self.post_ok_count += 1
                return "ok"
            self.post_fail_count += 1
            return "drop" if 400 <= status < 500 else "retry"
        except Exception as exc:
            print("POST failed:", exc)
            self.post_fail_count += 1
            self.last_post = "error"
            return "retry"
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    def enqueue(self, payload):
        self.queue.append(payload)
        while len(self.queue) > config.OFFLINE_BUFFER_MAX:
            self.queue.pop(0)
            self.dropped_count += 1

    def flush_queue(self):
        while self.queue:
            self.feed()
            if not self.wlan.isconnected() and not self.ensure_wifi():
                return
            result = self.post_payload(self.queue[0])
            if result == "ok" or result == "drop":
                self.queue.pop(0)
            else:
                self.ensure_wifi()
                return

    # -- local web server ------------------------------------------------------

    def start_web_server(self):
        if self.web_server or not self.wlan.isconnected():
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
                client.send("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n")
                client.send(json.dumps(self.latest_payload or {}))
            elif path.startswith("/api/diagnostics"):
                client.send("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n")
                client.send(json.dumps(self.diagnostics()))
            else:
                client.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nCache-Control: no-store\r\n\r\n")
                client.send(self.dashboard_page())
        except Exception as exc:
            print("Web request failed:", exc)
        finally:
            client.close()

    def diagnostics(self):
        return {
            "deviceSerial": self.device_serial,
            "firmwareVersion": config.FIRMWARE_VERSION,
            "uptimeS": time.ticks_diff(time.ticks_ms(), self.boot_ms) // 1000,
            "freeMem": gc.mem_free(),
            "timeSynced": self.time_synced,
            "wifiConnected": self.wlan.isconnected(),
            "queued": len(self.queue),
            "dropped": self.dropped_count,
            "postOk": self.post_ok_count,
            "postFail": self.post_fail_count,
            "lastPost": self.last_post
        }

    def dashboard_page(self):
        feats = self.last_features or {}
        diag = self.diagnostics()
        wifi_state = "online" if diag["wifiConnected"] else "offline"

        def val(key, unit=""):
            raw = feats.get(key)
            if raw is None:
                return "--"
            return "{}{}".format(raw, unit)

        return """<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Arborisis Bio</title>
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#f7f4f8;color:#231722}}
main{{max-width:620px;margin:auto;padding:18px}}
h1{{font-size:32px;line-height:1;margin:6px 0 16px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.card{{background:white;border:1px solid #e4dbe4;border-radius:8px;padding:14px;min-height:80px}}
.label{{color:#71637a;font-size:13px}} .value{{font-size:24px;font-weight:800;margin-top:8px}}
.wide{{grid-column:1/-1}} code{{word-break:break-all}}
.foot{{color:#71637a;font-size:12px;margin-top:14px;line-height:1.6}}
</style></head><body><main>
<div class="label">Arborisis Bio local &middot; v{version}</div><h1>{name}</h1>
<section class="grid">
<div class="card"><div class="label">Qualite</div><div class="value">{quality}</div></div>
<div class="card"><div class="label">RMS (comptes)</div><div class="value">{rms}</div></div>
<div class="card"><div class="label">Spikes</div><div class="value">{spikes}</div></div>
<div class="card"><div class="label">Pic-a-pic</div><div class="value">{p2p}</div></div>
<div class="card"><div class="label">Passages zero/s</div><div class="value">{zcr}</div></div>
<div class="card"><div class="label">Baseline</div><div class="value">{baseline}</div></div>
<div class="card wide"><div class="label">API locale</div><div><code>/api/readings</code> &middot; <code>/api/diagnostics</code></div></div>
</section>
<div class="foot">{wifi} &middot; uptime {uptime} min &middot; file {queued} (perdus {dropped}) &middot;
POST ok {ok}/ko {ko} &middot; dernier {last} &middot; RAM {mem} o &middot; horloge {clock}</div>
</main></body></html>""".format(
            version=config.FIRMWARE_VERSION,
            name=self.device_name,
            quality=val("qualityFlag"),
            rms=val("rmsRaw"),
            spikes=val("spikeCount"),
            p2p=val("p2pRaw"),
            zcr=val("zeroCrossRate"),
            baseline=val("baselineRaw"),
            wifi=wifi_state,
            uptime=diag["uptimeS"] // 60,
            queued=diag["queued"],
            dropped=diag["dropped"],
            ok=diag["postOk"],
            ko=diag["postFail"],
            last=diag["lastPost"],
            mem=diag["freeMem"],
            clock="OK" if diag["timeSynced"] else "non sync"
        )

    # -- provisioning access point ---------------------------------------------

    def setup_ap(self):
        try:
            network.country(config.COUNTRY)
        except Exception:
            pass
        ap = network.WLAN(network.AP_IF)
        ap.active(True)
        ap.config(essid=self.device_name, password=config.AP_PASSWORD, channel=6)
        ap.ifconfig(("192.168.4.1", "255.255.255.0", "192.168.4.1", "8.8.8.8"))
        self.sleep(2)
        print("Setup AP:", self.device_name, "password", config.AP_PASSWORD, ap.ifconfig(), "active", ap.active())
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("0.0.0.0", 80))
        server.listen(1)
        server.settimeout(1.0)
        page = self.setup_page()
        while True:
            self.feed()
            self.led_set(True)  # solid LED indicates provisioning mode.
            try:
                client, _ = server.accept()
            except OSError:
                continue
            try:
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
                    self.sleep(2)
                    machine.reset()
                else:
                    self.send_html(client, page)
                    client.close()
            except Exception as exc:
                print("Setup request failed:", exc)
                try:
                    client.close()
                except Exception:
                    pass

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
<h1>Arborisis Bio setup</h1>
{error}
<form method="post" action="/save">
<input name="ssid" placeholder="Wi-Fi SSID" value="{ssid}" required><br>
<input name="password" placeholder="Wi-Fi password" type="password" value="{password}"><br>
<input name="api_url" placeholder="API URL (/api/bioelectric)" value="{api_url}"><br>
<input name="device_token" placeholder="Device token" value="{token}"><br>
<input name="sample_rate_hz" placeholder="Frequence d'echantillonnage (Hz)" value="{rate}"><br>
<input name="window_seconds" placeholder="Duree fenetre (s)" value="{window}"><br>
<input name="bio_gain" placeholder="Gain front-end (0 = inconnu)" value="{gain}"><br>
<input name="bio_uv_per_count" placeholder="uV par compte a gain 1" value="{uvpc}"><br>
<input name="bio_bias_raw" placeholder="Offset DC en comptes (0 = auto)" value="{bias}"><br>
<input name="bio_oversample" placeholder="Sur-echantillonnage (electrodes directes)" value="{over}"><br>
<button>Save</button>
</form></body></html>""".format(
            error=error_html,
            ssid=self.settings.get("ssid", ""),
            password=self.settings.get("password", ""),
            api_url=self.settings.get("api_url", ""),
            token=self.settings.get("device_token", ""),
            rate=self.settings.get("sample_rate_hz", config.SAMPLE_RATE_HZ),
            window=self.settings.get("window_seconds", config.WINDOW_SECONDS),
            gain=self.settings.get("bio_gain", config.BIO_GAIN),
            uvpc=self.settings.get("bio_uv_per_count", config.BIO_UV_PER_COUNT),
            bias=self.settings.get("bio_bias_raw", config.BIO_BIAS_RAW),
            over=self.settings.get("bio_oversample", config.BIO_OVERSAMPLE)
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

    # -- main loop -------------------------------------------------------------

    def log_boot(self):
        causes = {
            getattr(machine, "PWRON_RESET", -1): "power-on",
            getattr(machine, "WDT_RESET", -2): "watchdog",
            getattr(machine, "HARD_RESET", -3): "hard",
            getattr(machine, "SOFT_RESET", -4): "soft",
            getattr(machine, "DEEPSLEEP_RESET", -5): "deepsleep"
        }
        try:
            cause = causes.get(machine.reset_cause(), "unknown")
        except Exception:
            cause = "unknown"
        print("Arborisis Bio", config.FIRMWARE_VERSION, self.device_name, "reset:", cause)

    def wait_cycle(self):
        seconds = self.cfg_int("sample_seconds", config.DEFAULT_SAMPLE_SECONDS)
        for _ in range(max(1, seconds)):
            self.feed()
            self.handle_web_once()
            time.sleep(1)

    def run(self):
        self.log_boot()
        if not self.connect_wifi():
            self.setup_ap()  # blocks until provisioned, then resets.
        try:
            self.wdt = WDT(timeout=config.WATCHDOG_MS)
        except Exception as exc:
            print("Watchdog unavailable:", exc)
        self.start_web_server()
        while True:
            try:
                self.feed()
                self.sync_time()
                payload = self.read_payload()
                self.latest_payload = payload
                self.enqueue(payload)
                self.flush_queue()
                self.start_web_server()
                self.heartbeat()
            except Exception as exc:
                print("Cycle failed:")
                sys.print_exception(exc)
                self.last_post = "cycle error"
            gc.collect()
            self.wait_cycle()


app = ArborisisBioPico()
app.run()
