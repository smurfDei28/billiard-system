const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function finalVerification() {
  const userId = '1ab996f5-db02-4b40-a71b-9c966548b0cb';
  
  try {
    console.log('FINAL VERIFICATION - Complete Data Snapshot');
    console.log('='.repeat(80));
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        loyaltyHistory: {
          where: { trigger: 'HOURS_MILESTONE' },
          orderBy: { createdAt: 'desc' }
        },
        notifications: {
          where: { type: 'LOYALTY_EARNED' },
          orderBy: { sentAt: 'desc' },
          take: 3
        },
        transactions: {
          where: { type: 'LOYALTY_REWARD' },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { table: { select: { tableNumber: true, type: true, ratePerHour: true } } }
        }
      }
    });
    
    console.log('\n📋 USER IDENTITY');
    console.log(`  ID: ${user.id}`);
    console.log(`  Name: ${user.firstName} ${user.lastName}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Phone: ${user.phone}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Created: ${new Date(user.createdAt).toISOString()}`);
    
    console.log('\n💳 MEMBERSHIP');
    console.log(`  ID: ${user.membership.id}`);
    console.log(`  Status: ${user.membership.status}`);
    console.log(`  Plan: ${user.membership.plan}`);
    console.log(`  Credit Balance: ${user.membership.creditBalance}`);
    console.log(`  Total Hours Played: ${user.membership.totalHoursPlayed} (TARGET: 21 hours) ✓`);
    console.log(`  Joined: ${new Date(user.membership.joinedAt).toISOString()}`);
    
    console.log('\n🎯 LOYALTY MILESTONE STATUS');
    console.log(`  HOURS_MILESTONE Records: ${user.loyaltyHistory.length} (expected: 1)`);
    
    if (user.loyaltyHistory.length > 0) {
      user.loyaltyHistory.forEach((record, idx) => {
        console.log(`\n  Record #${idx + 1}:`);
        console.log(`    ID: ${record.id}`);
        console.log(`    Trigger: ${record.trigger}`);
        console.log(`    Credits Awarded: ${record.creditsAwarded}`);
        console.log(`    Description: ${record.description}`);
        console.log(`    Created: ${new Date(record.createdAt).toISOString()}`);
      });
    }
    
    console.log('\n🔔 NOTIFICATIONS');
    console.log(`  Recent LOYALTY_EARNED: ${user.notifications.length}`);
    
    if (user.notifications.length > 0) {
      user.notifications.forEach((notif, idx) => {
        console.log(`\n  Notification #${idx + 1}:`);
        console.log(`    ID: ${notif.id}`);
        console.log(`    Type: ${notif.type}`);
        console.log(`    Title: ${notif.title}`);
        console.log(`    Message: ${notif.message}`);
        console.log(`    Sent: ${new Date(notif.sentAt).toISOString()}`);
        console.log(`    Read: ${notif.isRead}`);
      });
    }
    
    console.log('\n💰 CREDIT TRANSACTIONS');
    console.log(`  Recent LOYALTY_REWARD transactions: ${user.transactions.length}`);
    
    if (user.transactions.length > 0) {
      user.transactions.forEach((tx, idx) => {
        console.log(`\n  Transaction #${idx + 1}:`);
        console.log(`    ID: ${tx.id}`);
        console.log(`    Type: ${tx.type}`);
        console.log(`    Amount: ${tx.amount}`);
        console.log(`    Balance Before: ${tx.balanceBefore}`);
        console.log(`    Balance After: ${tx.balanceAfter}`);
        console.log(`    Description: ${tx.description}`);
        console.log(`    Created: ${new Date(tx.createdAt).toISOString()}`);
      });
    }
    
    console.log('\n📊 TABLE SESSIONS (Recent)');
    console.log(`  Total sessions: ${user.sessions.length}`);
    
    if (user.sessions.length > 0) {
      user.sessions.forEach((session, idx) => {
        const duration = session.endTime 
          ? ((new Date(session.endTime) - new Date(session.startTime)) / 1000 / 60).toFixed(1)
          : 'ACTIVE';
        console.log(`\n  Session #${idx + 1}:`);
        console.log(`    Table: ${session.table.tableNumber} (${session.table.type})`);
        console.log(`    Status: ${session.status}`);
        console.log(`    Duration: ${duration} min`);
        console.log(`    Credits Used: ${session.creditsUsed}`);
        console.log(`    Time: ${new Date(session.startTime).toISOString()} → ${session.endTime ? new Date(session.endTime).toISOString() : 'ongoing'}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ VERIFICATION CHECKLIST');
    console.log('='.repeat(80));
    
    const checks = {
      'User found': !!user,
      'User ID matches': user.id === userId,
      'First name is Ejay': user.firstName === 'Ejay',
      'Last name is Balsamo': user.lastName === 'Balsamo',
      'Membership active': user.membership.status === 'ACTIVE',
      'Total hours exactly 21': user.membership.totalHoursPlayed === 21,
      'Has 1 HOURS_MILESTONE reward': user.loyaltyHistory.length === 1,
      'Loyalty trigger correct': user.loyaltyHistory[0]?.trigger === 'HOURS_MILESTONE',
      'Reward amount is 120 credits': user.loyaltyHistory[0]?.creditsAwarded === 120,
      'Notification exists': user.notifications.length >= 1,
      'Notification type correct': user.notifications[0]?.type === 'LOYALTY_EARNED',
      'No duplicate rewards': user.loyaltyHistory.length === 1
    };
    
    Object.entries(checks).forEach(([check, passed]) => {
      console.log(`  ${passed ? '✓' : '✗'} ${check}`);
    });
    
    const allPassed = Object.values(checks).every(v => v);
    console.log('\n' + '='.repeat(80));
    console.log(allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await prisma.$disconnect();
  }
}

finalVerification();
