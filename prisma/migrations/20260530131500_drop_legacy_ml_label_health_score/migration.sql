-- Repair production drift from an earlier MLTrainingSample shape.
-- The application now stores the photo health label in "label"; a leftover
-- NOT NULL "labelHealthScore" column blocks Prisma inserts because it is not
-- part of the current Prisma model.

ALTER TABLE "MLTrainingSample"
  ADD COLUMN IF NOT EXISTS "label" DOUBLE PRECISION NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MLTrainingSample'
      AND column_name = 'labelHealthScore'
  ) THEN
    UPDATE "MLTrainingSample"
    SET "label" = "labelHealthScore"::double precision
    WHERE "label" IS NULL OR "label" = 0;

    ALTER TABLE "MLTrainingSample" DROP COLUMN "labelHealthScore";
  END IF;
END $$;
