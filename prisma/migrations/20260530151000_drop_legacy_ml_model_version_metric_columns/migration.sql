-- Legacy deployments briefly stored training metrics as required columns.
-- The current model stores them in MLModelVersion.metrics JSON instead.
ALTER TABLE "MLModelVersion" DROP COLUMN IF EXISTS "rmse";
ALTER TABLE "MLModelVersion" DROP COLUMN IF EXISTS "mae";
ALTER TABLE "MLModelVersion" DROP COLUMN IF EXISTS "valRmse";
ALTER TABLE "MLModelVersion" DROP COLUMN IF EXISTS "epochs";
