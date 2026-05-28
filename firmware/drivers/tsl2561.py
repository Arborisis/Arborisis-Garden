import time

TSL2561_ADDR = 0x39
TSL2561_ADDR_LOW = 0x29
TSL2561_ADDR_HIGH = 0x49
COMMAND = 0x80
CONTROL = 0x00
TIMING = 0x01
DATA0LOW = 0x0C
POWER_ON = 0x03


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
        self.i2c.writeto_mem(self.address, COMMAND | TIMING, bytes([0x02]))
        time.sleep_ms(450)

    def _read_u16(self, reg):
        data = self.i2c.readfrom_mem(self.address, COMMAND | reg, 2)
        return data[0] | (data[1] << 8)

    def read_lux(self):
        ch0 = self._read_u16(DATA0LOW)
        ch1 = self._read_u16(DATA0LOW + 2)
        if ch0 == 0:
            return 0

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
