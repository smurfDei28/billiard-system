const { PrismaClient } = require('@prisma/client');

// Keep one client per Node process. Every runtime module imports this file, so
// schedulers and HTTP handlers share the same conservative Prisma pool.
const prisma = global.__ibhmsPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') global.__ibhmsPrisma = prisma;

module.exports = prisma;
