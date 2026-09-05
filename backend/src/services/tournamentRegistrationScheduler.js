const prisma = require('../config/prisma');
const { closeTournamentRegistration } = require('./tournamentRegistration.service');

const REGISTRATION_DEADLINE_INTERVAL_MS = 60 * 1000;
let registrationDeadlineInterval = null;

const processDueTournamentRegistrationDeadlines = async ({
  db = prisma,
  closeRegistration = closeTournamentRegistration,
  now = new Date(),
  logger = console,
} = {}) => {
  let dueTournaments;
  try {
    dueTournaments = await db.tournament.findMany({
      where: {
        registrationDeadline: { not: null, lte: now },
        status: { in: ['UPCOMING', 'REGISTRATION_OPEN'] },
      },
      select: { id: true },
    });
  } catch (err) {
    logger.error('[Tournament Registration Scheduler Query Error]', err);
    return { processed: 0, failed: 1 };
  }

  let processed = 0;
  let failed = 0;
  for (const tournament of dueTournaments) {
    try {
      await closeRegistration(tournament.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      logger.error('[Tournament Registration Scheduler Close Error]', { tournamentId: tournament.id, err });
    }
  }
  return { processed, failed };
};

const startTournamentRegistrationScheduler = ({
  intervalMs = REGISTRATION_DEADLINE_INTERVAL_MS,
  runCycle = processDueTournamentRegistrationDeadlines,
  logger = console,
} = {}) => {
  if (registrationDeadlineInterval) return registrationDeadlineInterval;

  const runSafely = () => {
    Promise.resolve().then(runCycle).catch((err) => logger.error('[Tournament Registration Scheduler Error]', err));
  };
  runSafely();
  registrationDeadlineInterval = setInterval(runSafely, intervalMs);
  return registrationDeadlineInterval;
};

const stopTournamentRegistrationScheduler = () => {
  if (!registrationDeadlineInterval) return;
  clearInterval(registrationDeadlineInterval);
  registrationDeadlineInterval = null;
};

module.exports = {
  REGISTRATION_DEADLINE_INTERVAL_MS,
  processDueTournamentRegistrationDeadlines,
  startTournamentRegistrationScheduler,
  stopTournamentRegistrationScheduler,
};
