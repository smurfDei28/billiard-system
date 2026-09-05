const SPEND_REWARD_THRESHOLD = 120;
const SPEND_REWARD_CREDITS = 5;

// Credit balances are permanent. This module only awards earned credits; it
// never assigns an expiry date, removes a balance, or sends expiry notices.
const awardSpendReward = async (userId, db) => {
  const [spentTransactions, spentOrders, membership, existingRewards] = await Promise.all([
    db.creditTransaction.aggregate({
      where: { userId, type: 'DEDUCTION' },
      _sum: { amount: true },
    }),
    db.order.aggregate({
      where: { userId },
      _sum: { total: true },
    }),
    db.membership.findUnique({ where: { userId } }),
    db.loyaltyHistory.count({
      where: {
        userId,
        trigger: 'STREAK_BONUS',
        description: { startsWith: '[SPEND_REWARD]' },
      },
    }),
  ]);

  if (!membership) return;

  const totalSpent = (spentTransactions._sum.amount || 0) + (spentOrders._sum.total || 0);
  const earnedMilestones = Math.floor(totalSpent / SPEND_REWARD_THRESHOLD);
  const newRewards = earnedMilestones - existingRewards;

  if (newRewards <= 0) return;

  const rewardCredits = newRewards * SPEND_REWARD_CREDITS;
  const updatedMembership = await db.membership.update({
    where: { userId },
    data: { creditBalance: { increment: rewardCredits } },
  });

  for (let index = 0; index < newRewards; index += 1) {
    const milestone = (existingRewards + index + 1) * SPEND_REWARD_THRESHOLD;
    await db.loyaltyHistory.create({
      data: {
        userId,
        trigger: 'STREAK_BONUS',
        creditsAwarded: SPEND_REWARD_CREDITS,
        description: `[SPEND_REWARD] Earned ${SPEND_REWARD_CREDITS} bonus credits for every PHP ${SPEND_REWARD_THRESHOLD} spent. Milestone: PHP ${milestone}.`,
      },
    });
  }

  await db.creditTransaction.create({
    data: {
      userId,
      type: 'LOYALTY_REWARD',
      amount: rewardCredits,
      balanceBefore: membership.creditBalance,
      balanceAfter: updatedMembership.creditBalance,
      description: `Spend milestone reward: ${rewardCredits} bonus credits.`,
    },
  });

  await db.notification.create({
    data: {
      userId,
      type: 'LOYALTY_EARNED',
      title: 'Spend Reward Unlocked',
      message: `You earned ${rewardCredits} bonus credits for reaching a spending milestone.`,
    },
  });
};

module.exports = {
  SPEND_REWARD_THRESHOLD,
  SPEND_REWARD_CREDITS,
  awardSpendReward,
};
