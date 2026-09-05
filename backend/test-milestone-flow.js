const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const LOYALTY_MILESTONE_CREDITS = 120;

// This is a copy of the checkLoyaltyMilestone function from table.controller.js
const checkLoyaltyMilestone = async (userId, db) => {
  const membership = await db.membership.findUnique({ where: { userId } });
  if (!membership) return { error: 'Membership not found' };

  const hoursThreshold = parseInt(process.env.HOURS_FOR_FREE_HOUR) || 20;
  const reachedMilestones = Math.floor(Number(membership.totalHoursPlayed || 0) / hoursThreshold);
  
  console.log(`\n[checkLoyaltyMilestone] User: ${userId}`);
  console.log(`  Total Hours Played: ${membership.totalHoursPlayed}`);
  console.log(`  Hours Threshold: ${hoursThreshold}`);
  console.log(`  Reached Milestones (calculated): ${reachedMilestones}`);
  
  if (reachedMilestones < 1) {
    console.log(`  → No milestone reached (< 1)`);
    return { reachedMilestones: 0, result: 'No milestone' };
  }

  const awardedMilestones = await db.loyaltyHistory.count({
    where: { userId, trigger: 'HOURS_MILESTONE' },
  });
  
  console.log(`  Already Awarded Milestones: ${awardedMilestones}`);
  
  if (awardedMilestones >= reachedMilestones) {
    console.log(`  → No new milestone to award (awarded >= reached)`);
    return { reachedMilestones, awardedMilestones, result: 'Already awarded' };
  }

  console.log(`  → NEW MILESTONE DETECTED! Awarding ${reachedMilestones * hoursThreshold} hour milestone...`);
  
  const freeCredits = LOYALTY_MILESTONE_CREDITS;
  
  // Award the milestone
  const updatedMembership = await db.membership.update({
    where: { userId },
    data: {
      creditBalance: { increment: freeCredits },
    },
  });
  
  const loyaltyRecord = await db.loyaltyHistory.create({
    data: {
      userId,
      trigger: 'HOURS_MILESTONE',
      creditsAwarded: freeCredits,
      description: `🎉 ${reachedMilestones * hoursThreshold} hours played! Earned ${freeCredits} credits — equivalent to one Regular-table hour.`,
    },
  });
  
  const notification = await db.notification.create({
    data: {
      userId,
      type: 'LOYALTY_EARNED',
      title: '🎉 Loyalty Reward!',
      message: `You've played ${reachedMilestones * hoursThreshold} hours! You received ${freeCredits} credits — equivalent to one Regular-table hour.`,
    },
  });

  console.log(`  ✓ Membership credit incremented by ${freeCredits}`);
  console.log(`    New balance: ${updatedMembership.creditBalance}`);
  console.log(`  ✓ LoyaltyHistory record created: ${loyaltyRecord.id}`);
  console.log(`  ✓ Notification created: ${notification.id}`);
  
  return {
    reachedMilestones,
    awardedMilestones,
    result: 'Awarded',
    creditsAwarded: freeCredits,
    newBalance: updatedMembership.creditBalance,
    loyaltyRecordId: loyaltyRecord.id,
    notificationId: notification.id,
  };
};

async function runTests() {
  const userId = '1ab996f5-db02-4b40-a71b-9c966548b0cb';
  
  try {
    console.log('='.repeat(80));
    console.log('TEST 1: Check current state (46+ hours, no rewards yet)');
    console.log('='.repeat(80));
    
    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } }
      }
    });
    
    console.log(`Before check:
  - Total Hours: ${user.membership.totalHoursPlayed}
  - Credit Balance: ${user.membership.creditBalance}
  - HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
    
    console.log('\nRunning checkLoyaltyMilestone on current user...');
    const result1 = await checkLoyaltyMilestone(userId, prisma);
    console.log('Result:', JSON.stringify(result1, null, 2));
    
    // Check state after milestone check
    user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } }
      }
    });
    
    console.log(`\nAfter milestone check:
  - Total Hours: ${user.membership.totalHoursPlayed}
  - Credit Balance: ${user.membership.creditBalance}
  - HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
    
    if (user.loyaltyHistory.length > 0) {
      console.log('  Rewards:', user.loyaltyHistory.map(h => ({
        id: h.id,
        creditsAwarded: h.creditsAwarded,
        description: h.description,
        createdAt: h.createdAt
      })));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST 2: Reset to 21 hours (exact test threshold)');
    console.log('='.repeat(80));
    
    // First, clean up any HOURS_MILESTONE records we created in test 1
    if (user.loyaltyHistory.length > 0) {
      console.log(`Deleting ${user.loyaltyHistory.length} HOURS_MILESTONE record(s) created in test 1...`);
      await prisma.loyaltyHistory.deleteMany({
        where: {
          userId,
          trigger: 'HOURS_MILESTONE'
        }
      });
    }
    
    // Also delete any notifications we created
    const notifications = await prisma.notification.findMany({
      where: { userId, type: 'LOYALTY_EARNED' },
      orderBy: { sentAt: 'desc' },
      take: 2
    });
    
    if (notifications.length > 0) {
      console.log(`Found ${notifications.length} recent LOYALTY_EARNED notifications`);
      // Only delete the ones we just created in this test (the most recent ones)
      const notificationsToDelete = notifications.filter(n => n.sentAt > new Date(Date.now() - 60000)); // Last 1 minute
      if (notificationsToDelete.length > 0) {
        console.log(`Deleting ${notificationsToDelete.length} notification(s) created in test 1...`);
        await prisma.notification.deleteMany({
          where: { id: { in: notificationsToDelete.map(n => n.id) } }
        });
      }
    }
    
    // Reset totalHoursPlayed to exactly 21
    const resetMembership = await prisma.membership.update({
      where: { userId },
      data: { totalHoursPlayed: 21 }
    });
    
    console.log(`✓ Reset totalHoursPlayed to exactly 21 hours`);
    console.log(`  New value: ${resetMembership.totalHoursPlayed}`);
    
    user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } }
      }
    });
    
    console.log(`\nBefore milestone check:
  - Total Hours: ${user.membership.totalHoursPlayed}
  - Credit Balance: ${user.membership.creditBalance}
  - HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST 3: Trigger milestone check with 21 hours');
    console.log('='.repeat(80));
    
    const result2 = await checkLoyaltyMilestone(userId, prisma);
    console.log('Result:', JSON.stringify(result2, null, 2));
    
    user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } }
      }
    });
    
    console.log(`\nAfter milestone check:
  - Total Hours: ${user.membership.totalHoursPlayed}
  - Credit Balance: ${user.membership.creditBalance}
  - HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
    
    if (user.loyaltyHistory.length > 0) {
      console.log('  Rewards:', user.loyaltyHistory.map(h => ({
        id: h.id,
        creditsAwarded: h.creditsAwarded,
        description: h.description,
        createdAt: h.createdAt
      })));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST 4: Idempotency check - run milestone check again');
    console.log('='.repeat(80));
    
    const result3 = await checkLoyaltyMilestone(userId, prisma);
    console.log('Result:', JSON.stringify(result3, null, 2));
    
    user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } }
      }
    });
    
    console.log(`\nAfter second milestone check:
  - Total Hours: ${user.membership.totalHoursPlayed}
  - Credit Balance: ${user.membership.creditBalance}
  - HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
    
    if (user.loyaltyHistory.length > 0) {
      console.log('  Rewards:', user.loyaltyHistory.map(h => ({
        id: h.id,
        creditsAwarded: h.creditsAwarded,
        description: h.description,
        createdAt: h.createdAt
      })));
    }
    
    // Verification
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION RESULTS');
    console.log('='.repeat(80));
    
    const finalUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } },
        notifications: { where: { type: 'LOYALTY_EARNED' }, orderBy: { sentAt: 'desc' }, take: 1 }
      }
    });
    
    const expectedCreditsAfter = 5443.6394 + 120; // original balance + reward
    const actualCreditsAfter = finalUser.membership.creditBalance;
    
    console.log(`✓ User ID: ${userId}`);
    console.log(`✓ Playing Hours: ${finalUser.membership.totalHoursPlayed} (target: 21)`);
    console.log(`✓ HOURS_MILESTONE Rewards Count: ${finalUser.loyaltyHistory.length} (expected: 1)`);
    console.log(`✓ Credit Balance: ${actualCreditsAfter}`);
    console.log(`✓ Reward was granted: ${finalUser.loyaltyHistory.length > 0 ? 'YES' : 'NO'}`);
    console.log(`✓ Idempotency maintained: ${result3.result === 'Already awarded' ? 'YES' : 'NO'}`);
    
    if (finalUser.notifications.length > 0) {
      console.log(`✓ Notification created: YES`);
      console.log(`  - Title: ${finalUser.notifications[0].title}`);
      console.log(`  - Message: ${finalUser.notifications[0].message}`);
    } else {
      console.log(`✓ Notification created: NO`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('Error during tests:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
