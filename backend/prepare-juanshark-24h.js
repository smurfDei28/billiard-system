const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const LOYALTY_MILESTONE_CREDITS = 120;

const checkLoyaltyMilestone = async (userId, db) => {
  const membership = await db.membership.findUnique({ where: { userId } });
  if (!membership) return { error: 'Membership not found' };

  const hoursThreshold = parseInt(process.env.HOURS_FOR_FREE_HOUR) || 20;
  const reachedMilestones = Math.floor(Number(membership.totalHoursPlayed || 0) / hoursThreshold);
  
  console.log(`\n[checkLoyaltyMilestone] User: ${userId}`);
  console.log(`  Total Hours Played: ${membership.totalHoursPlayed}`);
  console.log(`  Reached Milestones: ${reachedMilestones}`);
  
  if (reachedMilestones < 1) {
    console.log(`  → No milestone reached`);
    return { reachedMilestones: 0 };
  }

  const awardedMilestones = await db.loyaltyHistory.count({
    where: { userId, trigger: 'HOURS_MILESTONE' },
  });
  
  console.log(`  Awarded Milestones: ${awardedMilestones}`);
  
  if (awardedMilestones >= reachedMilestones) {
    console.log(`  → No new milestone to award`);
    return { reachedMilestones, awardedMilestones, result: 'Already awarded' };
  }

  console.log(`  → Awarding ${reachedMilestones * hoursThreshold} hour milestone...`);
  
  const freeCredits = LOYALTY_MILESTONE_CREDITS;
  
  const updatedMembership = await db.membership.update({
    where: { userId },
    data: { creditBalance: { increment: freeCredits } },
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
      title: `${reachedMilestones * hoursThreshold}-Hour Playing Milestone Reached!`,
      message: `You received ${freeCredits} free Credits for completing ${reachedMilestones * hoursThreshold} hours of playing time. Keep playing to reach your next milestone!`,
    },
  });

  console.log(`  ✓ Milestone awarded successfully`);
  
  return {
    reachedMilestones,
    awardedMilestones,
    result: 'Awarded',
    creditsAwarded: freeCredits,
    newBalance: updatedMembership.creditBalance,
    loyaltyRecordId: loyaltyRecord.id,
    notificationId: notification.id,
    notificationTitle: notification.title,
    notificationMessage: notification.message,
  };
};

async function runJuanSharkTest() {
  const userId = '756665d1-ae86-466e-a842-d434559aabf2';
  
  try {
    console.log('='.repeat(80));
    console.log('TEST: JuanShark - 24 Hour Milestone Preparation');
    console.log('='.repeat(80));
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 1: Clean up existing test data');
    console.log('='.repeat(80));
    
    // Delete old HOURS_MILESTONE records
    const deletedLoyal = await prisma.loyaltyHistory.deleteMany({
      where: { userId, trigger: 'HOURS_MILESTONE' }
    });
    console.log(`✓ Deleted ${deletedLoyal.count} old HOURS_MILESTONE record(s)`);
    
    // Current state before changes
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { membership: true }
    });
    
    const creditsBefore = currentUser.membership.creditBalance;
    console.log(`✓ Current Credit Balance: ${creditsBefore}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 2: Reset to clean state (0 hours, minimal credits)');
    console.log('='.repeat(80));
    
    // Reset to clean state
    const resetMembership = await prisma.membership.update({
      where: { userId },
      data: { 
        totalHoursPlayed: 0,
        creditBalance: 0  // Start fresh
      }
    });
    console.log(`✓ Reset to: 0 hours, 0 credits`);
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 3: Set qualifying time to exactly 24 hours');
    console.log('='.repeat(80));
    
    // Set to exactly 24 hours
    const testMembership = await prisma.membership.update({
      where: { userId },
      data: { totalHoursPlayed: 24 }
    });
    console.log(`✓ Set totalHoursPlayed to: 24 hours`);
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 4: Verify milestone calculation');
    console.log('='.repeat(80));
    
    const hoursThreshold = 20;
    const reachedMilestones = Math.floor(24 / hoursThreshold);
    const progress = 24 - (reachedMilestones * hoursThreshold);
    
    console.log(`\n  Total Hours: 24`);
    console.log(`  Hours Threshold: 20`);
    console.log(`  Reached Milestones: ${reachedMilestones}`);
    console.log(`  Progress toward next: ${progress}/20 hours (${(progress/20*100).toFixed(1)}%)`);
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 5: Trigger milestone check');
    console.log('='.repeat(80));
    
    const result1 = await checkLoyaltyMilestone(userId, prisma);
    console.log('\nResult:', JSON.stringify(result1, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION: Check database state after first run');
    console.log('='.repeat(80));
    
    const user1 = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } },
        notifications: { 
          where: { type: 'LOYALTY_EARNED' },
          orderBy: { sentAt: 'desc' },
          take: 1
        }
      }
    });
    
    console.log(`\n✓ Playing Hours: ${user1.membership.totalHoursPlayed} (target: 24)`);
    console.log(`✓ Credit Balance: ${user1.membership.creditBalance}`);
    console.log(`✓ HOURS_MILESTONE records: ${user1.loyaltyHistory.length} (expected: 1)`);
    
    if (user1.loyaltyHistory.length > 0) {
      console.log(`  - Record ID: ${user1.loyaltyHistory[0].id}`);
      console.log(`  - Credits Awarded: ${user1.loyaltyHistory[0].creditsAwarded}`);
    }
    
    if (user1.notifications.length > 0) {
      console.log(`✓ Notification created: YES`);
      console.log(`  - ID: ${user1.notifications[0].id}`);
      console.log(`  - Title: ${user1.notifications[0].title}`);
      console.log(`  - Message: ${user1.notifications[0].message}`);
    } else {
      console.log(`✗ Notification created: NO`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('STEP 6: Idempotency check - Second evaluation');
    console.log('='.repeat(80));
    
    const result2 = await checkLoyaltyMilestone(userId, prisma);
    console.log('\nResult:', JSON.stringify(result2, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION: Check no duplicates were created');
    console.log('='.repeat(80));
    
    const user2 = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } },
        notifications: { 
          where: { type: 'LOYALTY_EARNED' },
          orderBy: { sentAt: 'desc' },
          take: 5
        }
      }
    });
    
    console.log(`\n✓ Playing Hours: ${user2.membership.totalHoursPlayed} (unchanged)`);
    console.log(`✓ Credit Balance: ${user2.membership.creditBalance} (unchanged)`);
    console.log(`✓ HOURS_MILESTONE records: ${user2.loyaltyHistory.length} (should still be 1)`);
    console.log(`✓ LOYALTY_EARNED notifications: ${user2.notifications.length} (should be 1)`);
    
    const idempotencyOk = result2.result === 'Already awarded' && 
                          user2.loyaltyHistory.length === 1 &&
                          user2.notifications.length === 1;
    
    console.log(`\n${idempotencyOk ? '✓' : '✗'} Idempotency check: ${idempotencyOk ? 'PASSED' : 'FAILED'}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    
    const finalUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: { where: { trigger: 'HOURS_MILESTONE' } },
        notifications: { where: { type: 'LOYALTY_EARNED' }, take: 1 }
      }
    });
    
    console.log(`\n📊 TEST DATA PREPARED:`);
    console.log(`  User: Juan dela Cruz (${userId})`);
    console.log(`  Email: player@saturdaynights.ph`);
    console.log(`  Total Hours Played: ${finalUser.membership.totalHoursPlayed}`);
    console.log(`  Credit Balance: ${finalUser.membership.creditBalance}`);
    console.log(`  HOURS_MILESTONE Rewards: ${finalUser.loyaltyHistory.length}`);
    
    if (finalUser.loyaltyHistory.length > 0) {
      console.log(`\n🎯 MILESTONE AWARDED:`);
      console.log(`  Threshold Reached: 20 hours`);
      console.log(`  Credits Awarded: ${finalUser.loyaltyHistory[0].creditsAwarded}`);
      console.log(`  Progress After Reward: ${24 - 20} hours toward next milestone`);
    }
    
    if (finalUser.notifications.length > 0) {
      console.log(`\n📬 NOTIFICATION:`);
      console.log(`  Title: ${finalUser.notifications[0].title}`);
      console.log(`  Message: ${finalUser.notifications[0].message}`);
    }
    
    const allChecks = {
      'Hours exactly 24': finalUser.membership.totalHoursPlayed === 24,
      'Credit increased by 120': finalUser.membership.creditBalance === 120,
      'Exactly 1 milestone record': finalUser.loyaltyHistory.length === 1,
      'Exactly 1 notification': finalUser.notifications.length === 1,
      'Notification title correct': finalUser.notifications[0]?.title?.includes('20'),
      'Idempotency verified': result2.result === 'Already awarded'
    };
    
    console.log('\n✅ CHECKS:');
    Object.entries(allChecks).forEach(([check, passed]) => {
      console.log(`  ${passed ? '✓' : '✗'} ${check}`);
    });
    
    const allPassed = Object.values(allChecks).every(v => v);
    console.log('\n' + '='.repeat(80));
    console.log(allPassed ? '✅ ALL TESTS PASSED - READY FOR TESTING' : '⚠️ SOME CHECKS FAILED');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runJuanSharkTest();
