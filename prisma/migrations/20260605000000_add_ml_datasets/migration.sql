-- AlterTable
ALTER TABLE "MLTrainingSample" ADD COLUMN     "featureSchemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MLModelVersion" ADD COLUMN     "datasetId" TEXT,
ADD COLUMN     "datasetVersion" TEXT,
ADD COLUMN     "featureSchemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "trainedFrom" TEXT NOT NULL DEFAULT 'samples';

-- CreateTable
CREATE TABLE "MLDataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "featureSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "labelDistribution" TEXT,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "plantIds" TEXT NOT NULL DEFAULT '[]',
    "filterSpec" TEXT,
    "snapshotObjectKey" TEXT,
    "checksum" TEXT,
    "license" TEXT NOT NULL DEFAULT 'CC-BY-4.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MLDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MLDatasetSample" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "sourceSampleId" TEXT,
    "plantId" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "features" TEXT NOT NULL,
    "label" DOUBLE PRECISION NOT NULL,
    "labelSource" TEXT NOT NULL,
    "featureSchemaVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MLDatasetSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MLDataset_slug_key" ON "MLDataset"("slug");

-- CreateIndex
CREATE INDEX "MLDataset_status_createdAt_idx" ON "MLDataset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MLDatasetSample_datasetId_idx" ON "MLDatasetSample"("datasetId");

-- CreateIndex
CREATE INDEX "MLModelVersion_datasetId_idx" ON "MLModelVersion"("datasetId");

-- AddForeignKey
ALTER TABLE "MLModelVersion" ADD CONSTRAINT "MLModelVersion_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MLDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MLDatasetSample" ADD CONSTRAINT "MLDatasetSample_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "MLDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

