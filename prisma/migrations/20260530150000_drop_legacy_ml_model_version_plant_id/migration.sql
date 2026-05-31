-- Some deployed databases briefly had MLModelVersion scoped to a plant.
-- The current app treats model versions as global, so this legacy NOT NULL
-- column prevents Prisma from creating new versions.
ALTER TABLE "MLModelVersion" DROP COLUMN IF EXISTS "plantId";
