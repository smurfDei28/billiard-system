const fail = (message, status = 409) => Object.assign(new Error(message), { status });

const normalizeScheduledAt = (scheduledAt) => {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) throw fail('A valid scheduled time is required', 400);
  date.setSeconds(0, 0);
  return date;
};

const loadOperationalMatch = async (db, matchId) => {
  const match = await db.tournamentMatch.findUnique({ where: { id: matchId }, include: { tournament: true } });
  if (!match) throw fail('Match not found', 404);
  if (match.tournament.status === 'COMPLETED') throw fail('Tournament is completed');
  if (match.status === 'COMPLETED' || match.status === 'BYE') throw fail('Match is not operationally editable');
  return match;
};

const assertTableAvailable = async (db, tableId, excludeMatchId = null) => {
  const [table, session, reservation, otherMatch] = await Promise.all([
    db.billiardTable.findUnique({ where: { id: tableId } }),
    db.tableSession.findFirst({ where: { tableId, status: 'ACTIVE' } }),
    db.reservation.findFirst({ where: { tableId, status: 'APPROVED', endTime: { gt: new Date() } } }),
    db.tournamentMatch.findFirst({ where: { tableId, status: 'IN_PROGRESS', ...(excludeMatchId && { id: { not: excludeMatchId } }) } }),
  ]);
  if (!table) throw fail('Table not found', 404);
  if (table.status !== 'AVAILABLE' || session || reservation || otherMatch) throw fail('Table is not available');
  return table;
};

const assertScheduleSlotAvailable = async (db, { tableId, scheduledAt, excludeMatchId = null }) => {
  if (!tableId || !scheduledAt) return;
  const conflict = await db.tournamentMatch.findFirst({
    where: {
      tableId,
      scheduledAt,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      ...(excludeMatchId && { id: { not: excludeMatchId } }),
    },
    select: { id: true },
  });
  if (conflict) throw fail('This table already has a match scheduled at that time');
};

const scheduleTournamentMatch = async ({ db, matchId, scheduledAt }) => {
  const match = await loadOperationalMatch(db, matchId);
  if (match.status === 'IN_PROGRESS') throw fail('Cannot reschedule a live match');
  const date = normalizeScheduledAt(scheduledAt);
  await assertScheduleSlotAvailable(db, { tableId: match.tableId, scheduledAt: date, excludeMatchId: matchId });
  return db.tournamentMatch.update({ where: { id: matchId }, data: { scheduledAt: date } });
};

const assignTournamentTable = async ({ db, matchId, tableId }) => {
  const match = await loadOperationalMatch(db, matchId);
  if (match.status === 'IN_PROGRESS') throw fail('Cannot reassign a live match');
  await assertTableAvailable(db, tableId, matchId);
  await assertScheduleSlotAvailable(db, { tableId, scheduledAt: match.scheduledAt, excludeMatchId: matchId });
  return db.tournamentMatch.update({ where: { id: matchId }, data: { tableId } });
};

const setupTournamentMatch = async ({ db, matchId, tableId, scheduledAt }) => {
  const match = await loadOperationalMatch(db, matchId);
  if (match.status === 'IN_PROGRESS') throw fail('Cannot change setup for a live match');
  const date = normalizeScheduledAt(scheduledAt);
  await assertTableAvailable(db, tableId, matchId);
  await assertScheduleSlotAvailable(db, { tableId, scheduledAt: date, excludeMatchId: matchId });
  return db.tournamentMatch.update({ where: { id: matchId }, data: { tableId, scheduledAt: date } });
};

const startTournamentMatch = async ({ db, matchId }) => {
  const match = await loadOperationalMatch(db, matchId);
  if (match.status === 'IN_PROGRESS') return { match, alreadyStarted: true };
  if (!match.player1Id || !match.player2Id) throw fail('Both match participants are required');
  if (!match.scheduledAt || !match.tableId) throw fail('Please assign a schedule and table before starting this match');
  await assertTableAvailable(db, match.tableId, matchId);
  const claim = await db.billiardTable.updateMany({ where: { id: match.tableId, status: 'AVAILABLE' }, data: { status: 'OCCUPIED' } });
  if (claim.count !== 1) throw fail('Table is no longer available');
  const updated = await db.tournamentMatch.update({ where: { id: matchId }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
  return { match: updated, alreadyStarted: false };
};

const releaseTournamentMatchTable = async ({ db, match }) => {
  if (!match.tableId || !db.billiardTable) return null;
  const other = await db.tournamentMatch.findFirst({ where: { tableId: match.tableId, status: 'IN_PROGRESS', id: { not: match.id } } });
  if (other) return null;
  await db.billiardTable.update({ where: { id: match.tableId }, data: { status: 'AVAILABLE' } });
  return match.tableId;
};

module.exports = { scheduleTournamentMatch, assignTournamentTable, setupTournamentMatch, startTournamentMatch, releaseTournamentMatchTable };
