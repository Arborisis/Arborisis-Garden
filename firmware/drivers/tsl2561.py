import time

TSL2561_ADDR = 0x39
TSL2561_ADDR_LOW = 0x29
TSL2561_ADDR_HIGH = 0x49
COMMAND = 0x80
CONTROL = 0x00
TIMING = 0x01
DATA0LOW = 0x0C
POWER_ON = 0x03
INTEGRATION_402MS = 0x02
GAIN_16X = 0x10


class TSL2561:
    def __init__(self, i2c, address=None):
        self.i2c = i2c
        scan = i2c.scan()
        if address is None:
            for candidate in (TSL2561_ADDR, TSL2561_ADDR_LOW, TSL2561_ADDR_HIGH):
                if candidate in scan:
                    address = candidate
                    break
        if address is None:
            raise OSError("TSL2561 light sensor not found")
        self.address = address
        if address not in scan:
            raise OSError("TSL2561 light sensor not found")
        self.i2c.writeto_mem(self.address, COMMAND | CONTROL, bytes([POWER_ON]))
        self.integration_ms = 402
        self.gain_16x = False
        timing = INTEGRATION_402MS | (GAIN_16X if self.gain_16x else 0)
        self.i2c.writeto_mem(self.address, COMMAND | TIMING, bytes([timing]))
        time.sleep_ms(450)

    def _read_u16(self, reg):
        data = self.i2c.readfrom_mem(self.address, COMMAND | reg, 2)
        return data[0] | (data[1] << 8)

    def read_lux(self):
        ch0 = self._read_u16(DATA0LOW)
        ch1 = self._read_u16(DATA0LOW + 2)
        if ch0 == 0:
            return 0

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
            lux = 0
        return max(0, lux)
