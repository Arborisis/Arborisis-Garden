import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("npx prisma migrate deploy");
} catch {
  // P3005: DB schema exists but no migration history — baseline all migrations
  console.log("Baselining existing migrations...");
  const migrations = [
    "20260529191000_init_postgres",
    "20260529200000_add_push_subscriptions",
    "20260529210000_add_ml_intelligence",
    "20260530000000_add_pairing_code",
  ];
  for (const m of migrations) {
    try {
      run(`npx prisma migrate resolve --applied "${m}"`);
    } catch {
      // already resolved, ignore
    }
  }
  run("npx prisma migrate deploy");
}
