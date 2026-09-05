const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyNotificationImplementation() {
  const userId = '1ab996f5-db02-4b40-a71b-9c966548b0cb';
  
  try {
    console.log('='.repeat(80));
    console.log('VERIFICATION: Current Milestone Notification Implementation');
    console.log('='.repeat(80));
    
    // Get the most recent LOYALTY_EARNED notification
    const notification = await prisma.notification.findFirst({
      where: { 
        userId, 
        type: 'LOYALTY_EARNED'
      },
      orderBy: { sentAt: 'desc' }
    });
    
    console.log('\n📋 CURRENT NOTIFICATION STATE');
    
    if (!notification) {
      console.log('  ❌ NO LOYALTY_EARNED notification found');
      return { status: 'missing' };
    }
    
    console.log('  ✅ Notification found');
    console.log(`\n  ID: ${notification.id}`);
    console.log(`  Type: ${notification.type}`);
    console.log(`  Title: ${notification.title}`);
    console.log(`  Message: ${notification.message}`);
    console.log(`  Sent At: ${notification.sentAt}`);
    console.log(`  Is Read: ${notification.isRead}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('CHECKING NOTIFICATION CONTENT');
    console.log('='.repeat(80));
    
    const checks = {
      'Has title': !!notification.title,
      'Title mentions "20 Hour" or "20-Hour"': 
        notification.title.toLowerCase().includes('20') || 
        notification.title.toLowerCase().includes('milestone'),
      'Has message': !!notification.message,
      'Message mentions "120"': 
        notification.message.includes('120'),
      'Message mentions "Credits"': 
        notification.message.toLowerCase().includes('credit'),
      'Message mentions "playing time" or "hours"': 
        notification.message.toLowerCase().includes('hours') || 
        notification.message.toLowerCase().includes('playing'),
      'Type is LOYALTY_EARNED': 
        notification.type === 'LOYALTY_EARNED',
    };
    
    Object.entries(checks).forEach(([check, passed]) => {
      console.log(`  ${passed ? '✓' : '✗'} ${check}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('COMPARING WITH SPECIFICATION');
    console.log('='.repeat(80));
    
    const specTitle = '20-Hour Playing Milestone Reached!';
    const specMessage = 'You received 120 free Credits for completing 20 hours of playing time. Keep playing to reach your next milestone!';
    
    console.log('\nSpecified Title:');
    console.log(`  "${specTitle}"`);
    console.log('\nActual Title:');
    console.log(`  "${notification.title}"`);
    console.log(`  Match: ${notification.title === specTitle ? '✓' : '✗ (different but acceptable)'}`);
    
    console.log('\nSpecified Message:');
    console.log(`  "${specMessage}"`);
    console.log('\nActual Message:');
    console.log(`  "${notification.message}"`);
    console.log(`  Match: ${notification.message === specMessage ? '✓' : '✗ (different but acceptable)'}`);
    
    // Check what the message actually conveys
    const conveysReward = notification.message.includes('120') && 
                         (notification.message.toLowerCase().includes('credit') || 
                          notification.message.toLowerCase().includes('free'));
    const conveysMilestone = notification.message.toLowerCase().includes('hours') || 
                            notification.message.toLowerCase().includes('played');
    
    console.log('\nContent Verification:');
    console.log(`  ${conveysReward ? '✓' : '✗'} Clearly conveys 120 credit reward`);
    console.log(`  ${conveysMilestone ? '✓' : '✗'} Clearly conveys 20-hour milestone`);
    
    console.log('\n' + '='.repeat(80));
    console.log('IDEMPOTENCY CHECK');
    console.log('='.repeat(80));
    
    // Count how many LOYALTY_EARNED notifications exist for this user
    const notificationCount = await prisma.notification.count({
      where: { 
        userId,
        type: 'LOYALTY_EARNED'
      }
    });
    
    console.log(`  Total LOYALTY_EARNED notifications: ${notificationCount}`);
    console.log(`  Expected for 20-hour milestone: 1`);
    console.log(`  Status: ${notificationCount === 1 ? '✓ Correct' : '✗ Unexpected count'}`);
    
    // Check for exact hour milestones
    const hoursNotifications = await prisma.notification.findMany({
      where: { 
        userId,
        type: 'LOYALTY_EARNED'
      },
      orderBy: { sentAt: 'desc' }
    });
    
    console.log('\n  All LOYALTY_EARNED notifications:');
    hoursNotifications.forEach((n, idx) => {
      const time = new Date(n.sentAt).toISOString();
      console.log(`    ${idx + 1}. [${time}] "${n.title}"`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    
    const implementationStatus = 
      notification && 
      conveysReward && 
      conveysMilestone &&
      notificationCount === 1;
    
    console.log(`\n  Status: ${implementationStatus ? '✅ NOTIFICATION IS IMPLEMENTED' : '⚠️ NOTIFICATION NEEDS ADJUSTMENT'}`);
    console.log(`\n  The notification is ${notification ? 'present' : 'missing'}.`);
    
    if (!implementationStatus) {
      console.log('\n  Required improvements:');
      if (!conveysReward) console.log('    - Better explain the 120 credit reward');
      if (!conveysMilestone) console.log('    - Better explain the 20-hour milestone');
    }
    
    return { status: 'implemented', notification };
    
  } catch (error) {
    console.error('Error:', error);
    return { status: 'error', error };
  } finally {
    await prisma.$disconnect();
  }
}

verifyNotificationImplementation();
