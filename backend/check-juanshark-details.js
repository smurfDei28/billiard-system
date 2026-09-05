const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUserDetails() {
  const userId = '756665d1-ae86-466e-a842-d434559aabf2';
  
  try {
    console.log('='.repeat(80));
    console.log('DETAILED USER STATE - JuanShark');
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
          take: 10
        },
        transactions: {
          where: { type: 'LOYALTY_REWARD' },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        sessions: {
          orderBy: { startTime: 'desc' },
          take: 20,
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
    console.log(`  Total Hours Played: ${user.membership.totalHoursPlayed}`);
    console.log(`  Joined: ${new Date(user.membership.joinedAt).toISOString()}`);

    console.log('\n🎯 LOYALTY MILESTONE STATUS');
    console.log(`  HOURS_MILESTONE Records: ${user.loyaltyHistory.length}`);
    
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

    console.log('\n🔔 NOTIFICATIONS (LOYALTY_EARNED)');
    console.log(`  Total: ${user.notifications.length}`);
    
    if (user.notifications.length > 0) {
      user.notifications.forEach((notif, idx) => {
        console.log(`\n  Notification #${idx + 1}:`);
        console.log(`    ID: ${notif.id}`);
        console.log(`    Title: ${notif.title}`);
        console.log(`    Message: ${notif.message}`);
        console.log(`    Sent: ${new Date(notif.sentAt).toISOString()}`);
      });
    }

    console.log('\n💰 CREDIT TRANSACTIONS (LOYALTY_REWARD)');
    console.log(`  Total: ${user.transactions.length}`);
    
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

    console.log('\n📊 TABLE SESSIONS');
    console.log(`  Total sessions: ${user.sessions.length}`);
    
    if (user.sessions.length > 0) {
      let totalDuration = 0;
      user.sessions.slice(0, 10).forEach((session, idx) => {
        if (session.status === 'ENDED' && session.endTime) {
          const duration = (new Date(session.endTime) - new Date(session.startTime)) / 1000 / 60;
          totalDuration += duration;
          console.log(`\n  Session #${idx + 1}:`);
          console.log(`    Table: ${session.table.tableNumber} (${session.table.type})`);
          console.log(`    Status: ${session.status}`);
          console.log(`    Duration: ${duration.toFixed(1)} min (${(duration / 60).toFixed(2)} hours)`);
          console.log(`    Credits Used: ${session.creditsUsed}`);
          console.log(`    Time: ${new Date(session.startTime).toISOString()}`);
        }
      });
      console.log(`\n  ⚠️ Total duration from recent sessions: ${(totalDuration / 60).toFixed(2)} hours`);
    } else {
      console.log('  No sessions found');
    }

    console.log('\n' + '='.repeat(80));
    console.log('CURRENT STATE SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n✓ Total Hours Played: ${user.membership.totalHoursPlayed} hours`);
    console.log(`✓ Credit Balance: ${user.membership.creditBalance} PHP`);
    console.log(`✓ HOURS_MILESTONE Rewards: ${user.loyaltyHistory.length}`);
    console.log(`\nNOTE: User already has 1 HOURS_MILESTONE reward but 0 hours played!`);
    console.log(`This appears to be test data. Will reset before proceeding.`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserDetails();
