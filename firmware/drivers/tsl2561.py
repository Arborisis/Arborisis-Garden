import time

TSL2561_ADDR = 0x39
TSL2561_ADDR_LOW = 0x29
TSL2561_ADDR_HIGH = 0x49
COMMAND = 0x80
CONTROL = 0x00
TIMING = 0x01
DATA0LOW = 0x0C
POWER_ON = 0x03
POWER_OFF = 0x00

# Timing register: integration time in the low bits, 16x gain on bit 4.
INTEGRATION_13MS = 0x00
INTEGRATION_101MS = 0x01
INTEGRATION_402MS = 0x02
GAIN_16X = 0x10

# Counts at which a channel is considered clipped for each integration time.
_SATURATION = {13: 4900, 101: 37000, 402: 65000}
# Settle delay (ms) to wait after (re)programming the timing register.
_SETTLE_MS = {13: 20, 101: 120, 402: 450}


class TSL2561:
    def __init__(self, i2c, address=None):
        self.i2c = i2c
        scan = i2c.scan()
        if address is None:
            for candidate in (TSL2561_ADDR, TSL2561_ADDR_LOW, TSL2561_ADDR_HIGH):
                if candidate in scan:
                    address = candidate
                    break
        if address is None or address not in scan:
            raise OSError("TSL2561 light sensor not found")
        self.address = address
        self.i2c.writeto_mem(self.address, COMMAND | CONTROL, bytes([POWER_ON]))
        self.integration_ms = 402
        self.gain_16x = True  # start sensitive, auto-range down if it clips.
        self._apply_timing()

    def _apply_timing(self):
        if self.integration_ms >= 402:
            integ = INTEGRATION_402MS
        elif self.integration_ms >= 101:
            integ = INTEGRATION_101MS
        else:
            integ = INTEGRATION_13MS
        timing = integ | (GAIN_16X if self.gain_16x else 0)
        self.i2c.writeto_mem(self.address, COMMAND | TIMING, bytes([timing]))
        time.sleep_ms(_SETTLE_MS.get(self.integration_ms, 450))

    def _read_u16(self, reg):
        data = self.i2c.readfrom_mem(self.address, COMMAND | reg, 2)
        return data[0] | (data[1] << 8)

    def _read_channels(self):
        ch0 = self._read_u16(DATA0LOW)
        ch1 = self._read_u16(DATA0LOW + 2)
        return ch0, ch1

    def read_lux(self):
        saturation = _SATURATION.get(self.integration_ms, 65000)
        ch0, ch1 = self._read_channels()

        # Auto-range: drop the gain when clipping, raise it when starved.
        if (ch0 >= saturation or ch1 >= saturation) and self.gain_16x:
            self.gain_16x = False
            self._apply_timing()
            ch0, ch1 = self._read_channels()
        elif ch0 < 200 and not self.gain_16x:
            self.gain_16x = True
            self._apply_timing()
            ch0, ch1 = self._read_channels()
            saturation = _SATURATION.get(self.integration_ms, 65000)

        if ch0 == 0:
            return 0.0
        # Still clipped at minimum gain: report the floor of the saturated range.
        if ch0 >= saturation or ch1 >= saturation:
            return 40000.0

        # Normalise counts to the 402 ms / 16x reference the datasheet curve uses.
        scale = 402 / self.integration_ms
        if not self.gain_16x:
            scale *= 16
        ch0 *= scale
        ch1 *= scale

        ratio = ch1 / ch0
        if ratio <= 0.5:
            lux = 0.0304 * ch0 - 0.062 * ch0 * (ratio ** 1.4)
        elif ratio <= 0.61:
            lux = 0.0224 * ch0 - 0.031 * ch1
        elif ratio <= 0.8:
            lux = 0.0128 * ch0 - 0.0153 * ch1
        elif ratio <= 1.3:
            lux = 0.00146 * ch0 - 0.00112 * ch1
        else:
            lux = 0.0
        return max(0.0, lux)
