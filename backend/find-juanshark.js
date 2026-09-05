const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function findTestUser() {
  try {
    // Find user by multiple identifiers
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: 'Juan', mode: 'insensitive' } },
          { lastName: { contains: 'Dela Cruz', mode: 'insensitive' } },
          { email: { contains: 'player@saturdaynights', mode: 'insensitive' } },
        ]
      },
      include: {
        membership: true,
        loyaltyHistory: {
          where: { trigger: 'HOURS_MILESTONE' },
          orderBy: { createdAt: 'desc' }
        },
        notifications: {
          where: { type: 'LOYALTY_EARNED' },
          orderBy: { sentAt: 'desc' },
          take: 5
        },
        transactions: {
          where: { type: 'LOYALTY_REWARD' },
          orderBy: { createdAt: 'desc' },
          take: 5
        },
        sessions: {
          orderBy: { startTime: 'desc' },
          take: 10,
          include: { table: true }
        }
      }
    });

    console.log('='.repeat(80));
    console.log('USER SEARCH RESULTS');
    console.log('='.repeat(80));

    if (users.length === 0) {
      console.log('\n❌ No users found matching the search criteria');
      return null;
    }

    console.log(`\nFound ${users.length} user(s):\n`);

    users.forEach((user, idx) => {
      console.log(`${idx + 1}. ${user.firstName} ${user.lastName}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Role: ${user.role}`);
      if (user.membership) {
        console.log(`   Membership Status: ${user.membership.status}`);
        console.log(`   Total Hours Played: ${user.membership.totalHoursPlayed}`);
        console.log(`   Credit Balance: ${user.membership.creditBalance}`);
        console.log(`   HOURS_MILESTONE rewards: ${user.loyaltyHistory.length}`);
      } else {
        console.log(`   No membership`);
      }
      console.log();
    });

    // Try to find exact match
    const exactMatch = users.find(u => 
      u.firstName === 'Juan' && 
      u.lastName === 'Dela Cruz' &&
      u.email === 'player@saturdaynights.ph'
    );

    if (exactMatch) {
      console.log('='.repeat(80));
      console.log('✅ EXACT MATCH FOUND');
      console.log('='.repeat(80));
      return exactMatch;
    }

    // Look for email exact match
    const emailMatch = users.find(u => u.email === 'player@saturdaynights.ph');
    if (emailMatch) {
      console.log('='.repeat(80));
      console.log('✅ EMAIL MATCH FOUND (Name may differ)');
      console.log('='.repeat(80));
      return emailMatch;
    }

    console.log('='.repeat(80));
    console.log('⚠️ NO EXACT MATCH - Multiple candidates');
    console.log('='.repeat(80));
    return null;

  } catch (error) {
    console.error('Error:', error);
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

findTestUser();
