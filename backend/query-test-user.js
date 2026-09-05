const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function findTestUser() {
  try {
    // Find user by username (firstName + lastName or email pattern)
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: { contains: 'Ejay', mode: 'insensitive' } },
          { lastName: { contains: 'Balsamo', mode: 'insensitive' } },
          { email: { contains: 'ejay', mode: 'insensitive' } },
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
          take: 5,
          include: { table: true }
        }
      }
    });

    console.log('Found users:', JSON.stringify(users, null, 2));

    if (users.length === 0) {
      console.log('No users found. Searching by exact name...');
      const exactUser = await prisma.user.findMany({
        where: {
          firstName: 'Ejay'
        },
        include: {
          membership: true,
          loyaltyHistory: {
            where: { trigger: 'HOURS_MILESTONE' }
          }
        }
      });
      console.log('Exact search result:', JSON.stringify(exactUser, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findTestUser();
