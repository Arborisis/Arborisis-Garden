# Optional BLE helper for MicroPython builds with aioble installed.
# Run/import this from main.py after sensor setup if you want BLE diagnostics.
import asyncio
import bluetooth
import json

import aioble

SERVICE_UUID = bluetooth.UUID("0000a001-0000-1000-8000-00805f9b34fb")
READING_UUID = bluetooth.UUID("0000a002-0000-1000-8000-00805f9b34fb")


class ArborisisBle:
    def __init__(self, name, read_payload):
        self.name = name
        self.read_payload = read_payload
        self.service = aioble.Service(SERVICE_UUID)
        self.reading = aioble.Characteristic(
            self.service,
            READING_UUID,
            read=True,
            notify=True,
            capture=False
        )
        aioble.register_services(self.service)

    async def advertise_forever(self):
        while True:
            async with await aioble.advertise(
                250000,
                name=self.name,
                services=[SERVICE_UUID],
                appearance=0
            ) as connection:
                while connection.is_connected():
                    payload = json.dumps(self.read_payload())[:180]
                    self.reading.write(payload.encode())
                    self.reading.notify(connection)
                    await asyncio.sleep(10)
