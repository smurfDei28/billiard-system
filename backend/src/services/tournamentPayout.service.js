const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const { notifyTournamentUsers } = require('./tournamentNotification.service');

// Cash prize payouts deliberately do not use Membership, CreditTransaction, or
// payment gateways. The completed bracket and ChampionTitle remain the sole
// sources of the recipient and amount.
const markTournamentPrizePaid = async ({ db, tournamentId, adminId, note }) => {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, status: true, finalPrizePool: true },
  });
  if (!tournament) throw fail('Tournament not found', 404);
  if (tournament.status !== 'COMPLETED') throw fail('Only completed tournaments can be paid out');
  if (tournament.finalPrizePool == null || Number(tournament.finalPrizePool) <= 0) throw fail('This tournament has no finalized prize pool to pay');

  const champion = await db.championTitle.findFirst({ where: { tournamentId }, orderBy: { earnedAt: 'desc' } });
  if (!champion) throw fail('Tournament champion has not been recorded');

  const existing = await db.tournamentPayout.findUnique({ where: { tournamentId } });
  if (existing) return { payout: existing, alreadyPaid: true };

  const payout = await db.tournamentPayout.create({
    data: {
      tournamentId,
      recipientId: champion.userId,
      amount: Number(tournament.finalPrizePool),
      method: 'CASH',
      status: 'PAID',
      paidAt: new Date(),
      paidById: adminId,
      note: note?.trim() || null,
    },
  });
  await db.staffAction.create({
    data: {
      staffId: adminId,
      action: 'TOURNAMENT_PRIZE_PAID_CASH',
      targetId: tournamentId,
      details: { tournamentId, tournamentName: tournament.name, championId: champion.userId, amount: payout.amount, method: 'CASH', payoutId: payout.id },
    },
  });
  await notifyTournamentUsers({
    db,
    userIds: [champion.userId],
    title: 'Tournament Cash Prize Paid',
    message: `${tournament.name}: your ₱${Number(payout.amount).toFixed(2)} cash prize has been recorded as paid by Admin.`,
    data: { tournamentId, payoutId: payout.id, amount: payout.amount, method: 'CASH' },
  });
  return { payout, alreadyPaid: false };
};

module.exports = { markTournamentPrizePaid };
