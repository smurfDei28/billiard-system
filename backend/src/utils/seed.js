const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Admin User ───
  const adminPassword = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@saturdaynights.ph' },
    update: {},
    create: {
      email: 'admin@saturdaynights.ph',
      phone: '09171234567',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'Saturday Nights',
      role: 'ADMIN',
    },
  });
  console.log('✅ Admin user created:', admin.email);
  console.log('   Password: Admin@123');

  // ─── Staff User ───
  const staffPassword = await bcrypt.hash('Staff@123', 12);
  const staff = await prisma.user.upsert({
    where: { email: 'staff@saturdaynights.ph' },
    update: {},
    create: {
      email: 'staff@saturdaynights.ph',
      phone: '09181234567',
      password: staffPassword,
      firstName: 'Staff',
      lastName: 'Member',
      role: 'STAFF',
    },
  });
  console.log('✅ Staff user created:', staff.email);
  console.log('   Password: Staff@123');

  // ─── Demo Member ───
  const memberPassword = await bcrypt.hash('Member@123', 12);
  const member = await prisma.user.upsert({
    where: { email: 'player@saturdaynights.ph' },
    update: {},
    create: {
      email: 'player@saturdaynights.ph',
      phone: '09191234567',
      password: memberPassword,
      firstName: 'Juan',
      lastName: 'dela Cruz',
      role: 'MEMBER',
      dateOfBirth: new Date('1995-06-15'),
    },
  });

  await prisma.membership.upsert({
    where: { userId: member.id },
    update: {},
    create: { userId: member.id, plan: 'BASIC', creditBalance: 120 },
  });

  await prisma.gamifiedProfile.upsert({
    where: { userId: member.id },
    update: {},
    create: {
      userId: member.id,
      displayName: 'JuanShark',
      level: 5,
      xp: 450,
      totalWins: 12,
      totalLosses: 8,
      totalGames: 20,
      rank: 'Shark',
      badges: ['first_win', 'ten_games'],
    },
  });
  console.log('✅ Demo member created:', member.email);
  console.log('   Password: Member@123');

  // ─── Billiard Tables ───
  const tables = [
    { tableNumber: 1, type: 'STANDARD', ratePerHour: 60 },
    { tableNumber: 2, type: 'STANDARD', ratePerHour: 60 },
    { tableNumber: 3, type: 'STANDARD', ratePerHour: 60 },
    { tableNumber: 4, type: 'STANDARD', ratePerHour: 60 },
    { tableNumber: 5, type: 'VIP', ratePerHour: 120 },
    { tableNumber: 6, type: 'VIP', ratePerHour: 120 },
  ];

  for (const table of tables) {
    await prisma.billiardTable.upsert({
      where: { tableNumber: table.tableNumber },
      update: {},
      create: table,
    });
  }
  console.log('✅ 6 billiard tables created (4 Standard, 2 VIP)');

  // ─── Products / Inventory ───
  const products = [
    // Rice Meals
    { name: 'Sinangag Express', category: 'RICE_MEAL', price: 85, stock: 50 },
    { name: 'Tapsilog', category: 'RICE_MEAL', price: 95, stock: 30 },
    { name: 'Longsilog', category: 'RICE_MEAL', price: 90, stock: 30 },
    // Drinks
    { name: 'Bottled Water', category: 'DRINKS', price: 20, stock: 100 },
    { name: 'Softdrinks (Regular)', category: 'DRINKS', price: 35, stock: 80 },
    { name: 'Iced Tea (Large)', category: 'DRINKS', price: 45, stock: 60 },
    { name: 'Sports Drink (Gatorade)', category: 'DRINKS', price: 55, stock: 40 },
    // Alcoholic Beverages
    { name: 'Red Horse Beer', category: 'ALCOHOLIC_BEVERAGES', price: 65, stock: 50 },
    { name: 'San Miguel Pale Pilsen', category: 'ALCOHOLIC_BEVERAGES', price: 60, stock: 50 },
    { name: 'Tanduay Ice', category: 'ALCOHOLIC_BEVERAGES', price: 55, stock: 30 },
    { name: 'Emperador Light', category: 'ALCOHOLIC_BEVERAGES', price: 180, stock: 20 },
    // Coffee
    { name: 'Brewed Coffee', category: 'COFFEE', price: 50, stock: 100 },
    { name: '3-in-1 Coffee', category: 'COFFEE', price: 25, stock: 100 },
    { name: 'Iced Coffee', category: 'COFFEE', price: 65, stock: 50 },
    // Billiard Equipment
    { name: 'Cue Chalk', category: 'BILLIARD_EQUIPMENT', price: 25, stock: 30 },
    { name: 'Billiard Glove', category: 'BILLIARD_EQUIPMENT', price: 150, stock: 15 },
    { name: 'Cue Tip Replacement', category: 'BILLIARD_EQUIPMENT', price: 80, stock: 20 },
    { name: 'Triangle Rack', category: 'BILLIARD_EQUIPMENT', price: 200, stock: 10 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: `prod_${product.name.replace(/\s/g, '_').toLowerCase()}` },
      update: {},
      create: { id: `prod_${product.name.replace(/\s/g, '_').toLowerCase()}`, ...product },
    });
  }
  console.log('✅ Products seeded (Rice Meals, Drinks, Alcohol, Coffee, Equipment)');

  console.log('\n🎱 Database seeded successfully!');
  console.log('\n📋 Login Credentials:');
  console.log('   Admin:  admin@saturdaynights.ph / Admin@123');
  console.log('   Staff:  staff@saturdaynights.ph / Staff@123');
  console.log('   Member: player@saturdaynights.ph / Member@123');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
