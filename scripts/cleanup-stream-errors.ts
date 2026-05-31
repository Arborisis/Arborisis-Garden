/**
 * Supprime les messages assistant pollues par les erreurs de streaming
 * ("Controller is already closed") persistes par l'ancien code de /api/chat.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/cleanup-stream-errors.ts          # dry-run (liste seulement)
 *   DATABASE_URL=... npx tsx scripts/cleanup-stream-errors.ts --apply  # supprime reellement
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PATTERNS = [
  "Controller is already closed",
  "Invalid state: Controller",
  "Erreur agentique: Invalid state"
];

async function main() {
  const apply = process.argv.includes("--apply");

  const matches = await prisma.chatMessage.findMany({
    where: {
      role: "assistant",
      OR: PATTERNS.map((p) => ({ content: { contains: p } }))
    },
    orderBy: { createdAt: "asc" }
  });

  if (matches.length === 0) {
    console.log("Aucun message d'erreur de streaming trouve. Rien a faire.");
    return;
  }

  console.log(`${matches.length} message(s) d'erreur trouve(s) :`);
  for (const m of matches) {
    console.log(`  - ${m.id} | plant=${m.plantId} | ${m.createdAt.toISOString()} | ${m.content.slice(0, 80)}`);
  }

  if (!apply) {
    console.log("\nDry-run. Relance avec --apply pour supprimer.");
    return;
  }

  const result = await prisma.chatMessage.deleteMany({
    where: { id: { in: matches.map((m) => m.id) } }
  });
  console.log(`\n${result.count} message(s) supprime(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
