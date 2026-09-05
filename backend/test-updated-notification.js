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
  
  // Award the milestone
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
    notificationId: notification.id,
    notificationTitle: notification.title,
    notificationMessage: notification.message,
  };
};

async function testUpdatedNotification() {
  try {
    console.log('='.repeat(80));
    console.log('TEST: Updated Milestone Notification Implementation');
    console.log('='.repeat(80));
    
    // Use the existing test user
    const userId = '1ab996f5-db02-4b40-a71b-9c966548b0cb';
    
    console.log('\n' + '='.repeat(80));
    console.log('SCENARIO 1: Clean state - Reset for fresh test');
    console.log('='.repeat(80));
    
    // Delete the old milestone records and notification
    const deletedLoyal = await prisma.loyaltyHistory.deleteMany({
      where: { userId, trigger: 'HOURS_MILESTONE' }
    });
    console.log(`✓ Deleted ${deletedLoyal.count} old HOURS_MILESTONE records`);
    
    // Delete the old notifications (keep only non-milestone ones)
    const allNotifs = await prisma.notification.findMany({
      where: { userId, type: 'LOYALTY_EARNED' },
      orderBy: { sentAt: 'desc' }
    });
    
    const notifToDelete = allNotifs.filter(n => 
      n.title.includes('Milestone') || n.title.includes('hour')
    );
    
    if (notifToDelete.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: notifToDelete.map(n => n.id) } }
      });
      console.log(`✓ Deleted ${notifToDelete.length} old milestone notifications`);
    }
    
    // Reset credit balance to before reward
    const resetMembership = await prisma.membership.update({
      where: { userId },
      data: { 
        totalHoursPlayed: 21,
        creditBalance: 5563.6394
      }
    });
    console.log(`✓ Reset to: 21 hours, ${resetMembership.creditBalance} credits`);
    
    console.log('\n' + '='.repeat(80));
    console.log('SCENARIO 2: First milestone trigger with updated notification');
    console.log('='.repeat(80));
    
    const result1 = await checkLoyaltyMilestone(userId, prisma);
    console.log('\nResult:', JSON.stringify(result1, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION: Check notification content');
    console.log('='.repeat(80));
    
    if (result1.notificationId) {
      console.log(`\n✓ Notification Created:`);
      console.log(`  ID: ${result1.notificationId}`);
      console.log(`\n  Title:`);
      console.log(`    "${result1.notificationTitle}"`);
      console.log(`\n  Message:`);
      console.log(`    "${result1.notificationMessage}"`);
      
      // Verify content
      const checks = {
        'Title includes milestone hours': result1.notificationTitle.includes('20'),
        'Title says "Milestone Reached"': result1.notificationTitle.includes('Milestone Reached'),
        'Message includes 120 credits': result1.notificationMessage.includes('120'),
        'Message says "free Credits"': result1.notificationMessage.includes('free Credits'),
        'Message mentions playing time': result1.notificationMessage.includes('playing time'),
        'Message includes hours count': result1.notificationMessage.includes('20'),
        'Message encourages next milestone': result1.notificationMessage.includes('next milestone'),
      };
      
      console.log('\n✓ Content Verification:');
      Object.entries(checks).forEach(([check, passed]) => {
        console.log(`    ${passed ? '✓' : '✗'} ${check}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('SCENARIO 3: Idempotency - Second evaluation');
    console.log('='.repeat(80));
    
    const result2 = await checkLoyaltyMilestone(userId, prisma);
    console.log('\nResult:', JSON.stringify(result2, null, 2));
    
    const idempotencyCheck = result2.result === 'Already awarded' && !result2.notificationId;
    console.log(`\n${idempotencyCheck ? '✓' : '✗'} Idempotency check: No duplicate created`);
    
    console.log('\n' + '='.repeat(80));
    console.log('SCENARIO 4: Database verification');
    console.log('='.repeat(80));
    
    const user = await prisma.user.findUnique({
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
    
    console.log(`\n📊 Database State:`);
    console.log(`  Credit Balance: ${user.membership.creditBalance}`);
    console.log(`  Total Hours: ${user.membership.totalHoursPlayed}`);
    console.log(`  HOURS_MILESTONE records: ${user.loyaltyHistory.length}`);
    console.log(`  Latest LOYALTY_EARNED notification:`);
    
    if (user.notifications[0]) {
      console.log(`    ID: ${user.notifications[0].id}`);
      console.log(`    Title: ${user.notifications[0].title}`);
      console.log(`    Message: ${user.notifications[0].message}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('FINAL VERIFICATION');
    console.log('='.repeat(80));
    
    const finalChecks = {
      'Credit increased by 120': user.membership.creditBalance === 5683.6394,
      'Hours set to 21': user.membership.totalHoursPlayed === 21,
      'Exactly 1 milestone record': user.loyaltyHistory.length === 1,
      'Notification title correct format': user.notifications[0]?.title?.includes('20') && user.notifications[0]?.title?.includes('Milestone'),
      'Notification message clear': user.notifications[0]?.message?.includes('120') && user.notifications[0]?.message?.includes('free Credits'),
    };
    
    console.log('\n✅ Checks:');
    Object.entries(finalChecks).forEach(([check, passed]) => {
      console.log(`  ${passed ? '✓' : '✗'} ${check}`);
    });
    
    const allPassed = Object.values(finalChecks).every(v => v);
    console.log('\n' + '='.repeat(80));
    console.log(allPassed ? '✅ ALL TESTS PASSED' : '⚠️ SOME CHECKS FAILED');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testUpdatedNotification();
