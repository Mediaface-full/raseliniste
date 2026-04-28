// Seed default lokací pro Calendar modul.
// Spusť ručně po migraci: npx tsx prisma/seed-locations.ts
import { prisma } from "../src/lib/db";

const seeds = [
  {
    name: "Praha",
    aliases: ["Prague", "Praha 1", "Praha 2", "Praha 5", "Praha 7", "Vinohrady", "Smíchov", "Karlín"],
    commuteMinPeak: 60,
    commuteMinOff: 35,
    isLocal: false,
  },
  {
    name: "Jílové u Prahy",
    aliases: ["domů", "home", "Studená 9", "Jílové"],
    commuteMinPeak: 0,
    commuteMinOff: 0,
    isLocal: true,
  },
  {
    name: "Plzeň",
    aliases: ["Pilsen"],
    commuteMinPeak: 90,
    commuteMinOff: 75,
    isLocal: false,
  },
  {
    name: "Brno",
    aliases: [],
    commuteMinPeak: 150,
    commuteMinOff: 130,
    isLocal: false,
  },
];

async function main() {
  for (const s of seeds) {
    await prisma.location.upsert({
      where: { name: s.name },
      create: s,
      update: {
        aliases: s.aliases,
        commuteMinPeak: s.commuteMinPeak,
        commuteMinOff: s.commuteMinOff,
        isLocal: s.isLocal,
      },
    });
    console.log(`✓ ${s.name}`);
  }
  console.log("done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
