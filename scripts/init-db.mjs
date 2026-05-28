import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const databaseUrl =
  process.env.DATABASE_URL?.replace(/^file:/, "") ?? "./dev.db";
const dbPath = resolve("prisma", databaseUrl.replace(/^\.\//, ""));

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serial" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT,
  "lastSeen" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Plant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "species" TEXT,
  "location" TEXT,
  "notes" TEXT,
  "deviceId" TEXT,
  "moistureDryRaw" INTEGER NOT NULL DEFAULT 52000,
  "moistureWetRaw" INTEGER NOT NULL DEFAULT 22000,
  "targetMoisture" INTEGER NOT NULL DEFAULT 48,
  "minLightLux" INTEGER NOT NULL DEFAULT 250,
  "maxSoilTempC" REAL NOT NULL DEFAULT 30,
  "minSoilTempC" REAL NOT NULL DEFAULT 10,
  "memorySummary" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Plant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Reading" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "plantId" TEXT,
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "soilMoistureRaw" INTEGER,
  "soilMoisturePct" REAL,
  "soilTempC" REAL,
  "airTempC" REAL,
  "airHumidityPct" REAL,
  "pressureHpa" REAL,
  "lightLux" REAL,
  "batteryMv" INTEGER,
  "wifiRssi" INTEGER,
  "firmwareVersion" TEXT,
  CONSTRAINT "Reading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Reading_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Alert" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plantId" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alert_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Memory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Memory_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plantId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Device_serial_key" ON "Device"("serial");
CREATE INDEX IF NOT EXISTS "Reading_deviceId_recordedAt_idx" ON "Reading"("deviceId", "recordedAt");
CREATE INDEX IF NOT EXISTS "Reading_plantId_recordedAt_idx" ON "Reading"("plantId", "recordedAt");
CREATE INDEX IF NOT EXISTS "Alert_plantId_status_createdAt_idx" ON "Alert"("plantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Memory_plantId_createdAt_idx" ON "Memory"("plantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChatMessage_plantId_createdAt_idx" ON "ChatMessage"("plantId", "createdAt");
`);

db.close();
console.log(`SQLite database ready at ${dbPath}`);
