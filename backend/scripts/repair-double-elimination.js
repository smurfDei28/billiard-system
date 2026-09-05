const prisma = require('../src/config/prisma');
const { auditDoubleEliminationTournament } = require('./audit-double-elimination');
const { repairLegacyDoubleEliminationBracket } = require('../src/services/repairLegacyDoubleElimination.service');

const argument = (prefix) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);

const run = async () => {
  const tournamentId = String(process.argv[2] || '').trim();
  if (!tournamentId) throw new Error('Usage: node scripts/repair-double-elimination.js <tournament-id> [--apply --confirm=<tournament-id>]');

  const audit = await auditDoubleEliminationTournament(prisma, tournamentId);
  console.log(JSON.stringify(audit, null, 2));
  if (!process.argv.includes('--apply')) {
    console.log('READ-ONLY AUDIT COMPLETE. No database records were changed.');
    return;
  }
  if (argument('--confirm=') !== tournamentId) throw new Error('Apply refused. Pass --confirm=<the-same-tournament-id> to repair this one tournament.');
  if (!audit.requiresTournamentSpecificRepair) throw new Error('Apply refused. Audit did not identify a recognized legacy winners-only bracket.');

  const result = await prisma.$transaction(
    (db) => repairLegacyDoubleEliminationBracket({ db, tournamentId }),
    { isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 },
  );
  console.log(JSON.stringify(result, null, 2));
};

if (require.main === module) {
  run()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
