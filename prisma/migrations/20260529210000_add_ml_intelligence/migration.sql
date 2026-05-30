-- CreateTable
CREATE TABLE "MLTrainingSample" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "features" TEXT NOT NULL,
    "label" DOUBLE PRECISION NOT NULL,
    "labelSource" TEXT NOT NULL DEFAULT 'photo',
    "photoId" TEXT,
    "prediction" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MLTrainingSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MLModelVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleCount" INTEGER NOT NULL,
    "weights" TEXT NOT NULL,
    "metrics" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MLModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MLTrainingSample_plantId_sampledAt_idx" ON "MLTrainingSample"("plantId", "sampledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MLModelVersion_version_key" ON "MLModelVersion"("version");

-- AddForeignKey
ALTER TABLE "MLTrainingSample" ADD CONSTRAINT "MLTrainingSample_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
