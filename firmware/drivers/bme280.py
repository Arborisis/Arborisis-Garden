# Minimal BME280 driver for MicroPython.
from micropython import const
import time

BME280_ADDR = const(0x76)
BME280_ADDR_ALT = const(0x77)


class BME280:
    def __init__(self, i2c, address=None):
        self.i2c = i2c
        scan = i2c.scan()
        if address is None:
            if BME280_ADDR in scan:
                address = BME280_ADDR
            elif BME280_ADDR_ALT in scan:
                address = BME280_ADDR_ALT
            else:
                raise OSError("BME280 not found")
        self.address = address
        self._read_calibration()
        self.i2c.writeto_mem(self.address, 0xF2, bytes([1]))
        self.i2c.writeto_mem(self.address, 0xF4, bytes([0x27]))
        self.i2c.writeto_mem(self.address, 0xF5, bytes([0xA0]))
        time.sleep_ms(100)

    def _u16(self, data, idx):
        return data[idx] | (data[idx + 1] << 8)

    def _s16(self, data, idx):
        value = self._u16(data, idx)
        return value - 65536 if value > 32767 else value

    def _read_calibration(self):
        calib = self.i2c.readfrom_mem(self.address, 0x88, 26)
        hum = self.i2c.readfrom_mem(self.address, 0xE1, 7)
        self.dig_T1 = self._u16(calib, 0)
        self.dig_T2 = self._s16(calib, 2)
        self.dig_T3 = self._s16(calib, 4)
        self.dig_P1 = self._u16(calib, 6)
        self.dig_P2 = self._s16(calib, 8)
        self.dig_P3 = self._s16(calib, 10)
        self.dig_P4 = self._s16(calib, 12)
        self.dig_P5 = self._s16(calib, 14)
        self.dig_P6 = self._s16(calib, 16)
        self.dig_P7 = self._s16(calib, 18)
        self.dig_P8 = self._s16(calib, 20)
        self.dig_P9 = self._s16(calib, 22)
        self.dig_H1 = calib[25]
        self.dig_H2 = hum[0] | (hum[1] << 8)
        if self.dig_H2 > 32767:
            self.dig_H2 -= 65536
        self.dig_H3 = hum[2]
        self.dig_H4 = (hum[3] << 4) | (hum[4] & 0x0F)
        if self.dig_H4 > 2047:
            self.dig_H4 -= 4096
        self.dig_H5 = (hum[5] << 4) | (hum[4] >> 4)
        if self.dig_H5 > 2047:
            self.dig_H5 -= 4096
        self.dig_H6 = hum[6]
        if self.dig_H6 > 127:
            self.dig_H6 -= 256

    def read(self):
        data = self.i2c.readfrom_mem(self.address, 0xF7, 8)
        adc_p = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        adc_t = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)
        adc_h = (data[6] << 8) | data[7]

        var1 = (((adc_t >> 3) - (self.dig_T1 << 1)) * self.dig_T2) >> 11
        var2 = (((((adc_t >> 4) - self.dig_T1) * ((adc_t >> 4) - self.dig_T1)) >> 12) * self.dig_T3) >> 14
        t_fine = var1 + var2
        temp_c = ((t_fine * 5 + 128) >> 8) / 100

        var1 = t_fine - 128000
        var2 = var1 * var1 * self.dig_P6
        var2 = var2 + ((var1 * self.dig_P5) << 17)
        var2 = var2 + (self.dig_P4 << 35)
        var1 = ((var1 * var1 * self.dig_P3) >> 8) + ((var1 * self.dig_P2) << 12)
        var1 = (((1 << 47) + var1) * self.dig_P1) >> 33
        pressure = 0
        if var1:
            pressure = 1048576 - adc_p
            pressure = (((pressure << 31) - var2) * 3125) // var1
            var1 = (self.dig_P9 * (pressure >> 13) * (pressure >> 13)) >> 25
            var2 = (self.dig_P8 * pressure) >> 19
            pressure = ((pressure + var1 + var2) >> 8) + (self.dig_P7 << 4)

        h = t_fine - 76800
        h = (((((adc_h << 14) - (self.dig_H4 << 20) - (self.dig_H5 * h)) + 16384) >> 15) *
             (((((((h * self.dig_H6) >> 10) * (((h * self.dig_H3) >> 11) + 32768)) >> 10) + 2097152) *
               self.dig_H2 + 8192) >> 14))
        h = h - (((((h >> 15) * (h >> 15)) >> 7) * self.dig_H1) >> 4)
        h = 0 if h < 0 else h
        h = 419430400 if h > 419430400 else h
        humidity = (h >> 12) / 1024

        return {
            "airTempC": temp_c,
            "airHumidityPct": humidity,
            "pressureHpa": (pressure / 256) / 100
        }
