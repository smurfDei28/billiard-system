// Uses the existing TournamentEntry cancellation-fee fields.  This is called
// from the same transaction that credits a wallet, so a fee cannot be charged
// twice or leave a negative balance.
const settlePendingCancellationFees = async (tx, userId, staffId = null) => {
  let membership = await tx.membership.findUnique({ where: { userId } });
  if (!membership) return { paid: [], balance: null };

  const pending = await tx.tournamentEntry.findMany({
    where: { userId, cancellationFeeStatus: 'PENDING', cancellationFee: { gt: 0 } },
    include: { tournament: { select: { name: true } } },
    orderBy: [{ cancelledAt: 'asc' }, { registeredAt: 'asc' }],
  });
  const pendingMatchLosses = await tx.tournamentFeeLiability.findMany({
    where: { userId, feeType: 'TOURNAMENT_MATCH_LOSS', status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  const obligations = [
    ...pending.map((entry) => ({ kind: 'CANCELLATION', id: entry.id, amount: Number(entry.cancellationFee || 0), createdAt: entry.cancelledAt || entry.registeredAt, entry })),
    ...pendingMatchLosses.map((liability) => ({ kind: 'MATCH_LOSS', id: liability.id, amount: Number(liability.amount || 0), createdAt: liability.createdAt, liability })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const paid = [];
  for (const obligation of obligations) {
    const fee = obligation.amount;
    if (Number(membership.creditBalance) < fee) break; // oldest fee must be settled first; never partial-pay
    const updatedMembership = await tx.membership.update({
      where: { userId }, data: { creditBalance: { decrement: fee } },
    });
    if (obligation.kind === 'CANCELLATION') {
      await tx.tournamentEntry.update({ where: { id: obligation.id }, data: { cancellationFeeStatus: 'PAID', cancellationFeePaidAt: new Date() } });
    } else {
      await tx.tournamentFeeLiability.update({ where: { id: obligation.id }, data: { status: 'PAID', paidAt: new Date() } });
    }
    const transaction = await tx.creditTransaction.create({
      data: {
        userId, type: 'DEDUCTION', amount: fee, balanceBefore: membership.creditBalance,
        balanceAfter: updatedMembership.creditBalance,
        description: obligation.kind === 'CANCELLATION' ? `Tournament cancellation fee: ${obligation.entry.tournament.name}` : 'Tournament match loss fee settlement',
        staffId,
      },
    });
    if (obligation.kind === 'MATCH_LOSS') await tx.tournamentFeeLiability.update({ where: { id: obligation.id }, data: { creditTransactionId: transaction.id } });
    await tx.notification.create({ data: obligation.kind === 'CANCELLATION' ? {
      userId, type: 'TOURNAMENT_CANCELLED', title: 'Cancellation Fee Paid', message: `Your ${fee.toFixed(2)} credit cancellation fee for "${obligation.entry.tournament.name}" was automatically deducted after your top-up.`, data: { entryId: obligation.id, cancellationFee: fee, cancellationFeeStatus: 'PAID' },
    } : {
      userId, type: 'SYSTEM', title: 'Tournament Match Loss Fee Paid', message: `Your ${fee.toFixed(2)} credit tournament match-loss fee was automatically deducted after your top-up.`, data: { liabilityId: obligation.id, amount: fee, status: 'PAID' },
    } });
    membership = updatedMembership;
    paid.push({ entryId: obligation.kind === 'CANCELLATION' ? obligation.id : undefined, liabilityId: obligation.kind === 'MATCH_LOSS' ? obligation.id : undefined, amount: fee, tournamentName: obligation.entry?.tournament.name });
  }
  const stillPending = await tx.tournamentEntry.count({ where: { userId, cancellationFeeStatus: 'PENDING', cancellationFee: { gt: 0 } } });
  await tx.user.update({ where: { id: userId }, data: { hasPendingCancellationFee: stillPending > 0 } });
  return { paid, balance: membership.creditBalance };
};

module.exports = { settlePendingCancellationFees };
