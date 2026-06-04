-- Device: distinguish environment vs bioelectric devices
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'environment';

-- CreateTable
CREATE TABLE IF NOT EXISTS "BioReading" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "plantId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firmwareVersion" TEXT,
    "sampleRateHz" INTEGER NOT NULL,
    "windowSeconds" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "channel" TEXT,
    "gain" DOUBLE PRECISION,
    "baselineRaw" DOUBLE PRECISION,
    "baselineUv" DOUBLE PRECISION,
    "meanUv" DOUBLE PRECISION,
    "rmsUv" DOUBLE PRECISION,
    "rmsRaw" DOUBLE PRECISION,
    "stdRaw" DOUBLE PRECISION,
    "p2pRaw" DOUBLE PRECISION,
    "minRaw" DOUBLE PRECISION,
    "maxRaw" DOUBLE PRECISION,
    "slopeRawPerSec" DOUBLE PRECISION,
    "spikeCount" INTEGER,
    "zeroCrossRate" DOUBLE PRECISION,
    "bandLowEnergy" DOUBLE PRECISION,
    "bandMidEnergy" DOUBLE PRECISION,
    "bandHighEnergy" DOUBLE PRECISION,
    "activityIndex" DOUBLE PRECISION,
    "qualityFlag" TEXT,
    "waveform" TEXT,
    "batteryMv" INTEGER,
    "wifiRssi" INTEGER,

    CONSTRAINT "BioReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BioResponseEvent" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "baselineRms" DOUBLE PRECISION NOT NULL,
    "responseRms" DOUBLE PRECISION NOT NULL,
    "responseRatio" DOUBLE PRECISION NOT NULL,
    "latencyMin" DOUBLE PRECISION,
    "reacted" BOOLEAN NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BioResponseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BioReading_deviceId_recordedAt_idx" ON "BioReading"("deviceId", "recordedAt");
CREATE INDEX IF NOT EXISTS "BioReading_plantId_recordedAt_idx" ON "BioReading"("plantId", "recordedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BioResponseEvent_plantId_eventType_eventAt_key" ON "BioResponseEvent"("plantId", "eventType", "eventAt");
CREATE INDEX IF NOT EXISTS "BioResponseEvent_plantId_eventAt_idx" ON "BioResponseEvent"("plantId", "eventAt");

-- AddForeignKey
ALTER TABLE "BioReading" ADD CONSTRAINT "BioReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BioReading" ADD CONSTRAINT "BioReading_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BioResponseEvent" ADD CONSTRAINT "BioResponseEvent_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
