import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

run("npx prisma migrate deploy");

if (process.env.PRISMA_BASELINE_MIGRATIONS === "1") {
  console.warn(
    "PRISMA_BASELINE_MIGRATIONS is no longer handled at runtime. Baseline migrations manually after verifying the target database schema.",
  );
}
