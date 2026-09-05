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
    { tableNumber: 1, type: 'STANDARD', ratePerHour: 120 },
    { tableNumber: 2, type: 'STANDARD', ratePerHour: 120 },
    { tableNumber: 3, type: 'STANDARD', ratePerHour: 120 },
    { tableNumber: 4, type: 'STANDARD', ratePerHour: 120 },
    { tableNumber: 5, type: 'VIP', ratePerHour: 200 },
    { tableNumber: 6, type: 'VIP', ratePerHour: 200 },
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
  const makeProductId = (name) => `prod_${name.replace(/\s/g, '_').toLowerCase()}`;

  // Current menu (Apr 2026). Note: equipment list stays unchanged.
  const menuProducts = [
    // Main Dishes (Rice Meals)
    { name: 'Hotsilog', category: 'RICE_MEAL', price: 110, stock: 30 },
    { name: 'Tocilog', category: 'RICE_MEAL', price: 120, stock: 30 },
    { name: 'Longsilog', category: 'RICE_MEAL', price: 125, stock: 30 },
    { name: 'Sisigsilog', category: 'RICE_MEAL', price: 135, stock: 25 },
    { name: 'Sisig', category: 'RICE_MEAL', price: 180, stock: 20 },

    // Snacks / Sides / Add-ons
    { name: 'French Fries', category: 'SNACKS', price: 90, stock: 40 },
    { name: 'Cheese Sticks', category: 'SNACKS', price: 120, stock: 40 },
    { name: 'Shanghai', category: 'SNACKS', price: 145, stock: 35 },
    { name: 'Cup Noodles', category: 'SNACKS', price: 35, stock: 80 },
    { name: 'Pancit Canton', category: 'SNACKS', price: 35, stock: 80 },
    { name: 'Chips', category: 'SNACKS', price: 25, stock: 80 },
    { name: 'Extra Rice', category: 'SNACKS', price: 20, stock: 80 },
    { name: 'Extra Egg', category: 'SNACKS', price: 20, stock: 80 },

    // Beverages (Alcohol)
    { name: 'Red Horse', category: 'ALCOHOLIC_BEVERAGES', price: 95, stock: 60 },
    { name: 'San Mig Light', category: 'ALCOHOLIC_BEVERAGES', price: 85, stock: 60 },
    { name: 'San Mig Pale Pilsen', category: 'ALCOHOLIC_BEVERAGES', price: 75, stock: 60 },
    { name: 'Smirnoff Mule', category: 'ALCOHOLIC_BEVERAGES', price: 75, stock: 40 },
    { name: 'Alfonso', category: 'ALCOHOLIC_BEVERAGES', price: 400, stock: 15 },

    // Beverages (Non-alcohol)
    { name: 'Coke', category: 'DRINKS', price: 25, stock: 120 },
    { name: 'Royal', category: 'DRINKS', price: 25, stock: 120 },
    { name: 'Mountain Dew', category: 'DRINKS', price: 25, stock: 120 },
    { name: 'Mineral Water (large)', category: 'DRINKS', price: 35, stock: 120 },
    { name: 'Coke 1.5', category: 'DRINKS', price: 120, stock: 30 },

    // Coffee (remove 3-in-1; add cafe-style options avg ₱90–₱120)
    { name: 'Americano (Hot)', category: 'COFFEE', price: 95, stock: 100 },
    { name: 'Latte (Hot)', category: 'COFFEE', price: 110, stock: 100 },
    { name: 'Cappuccino (Hot)', category: 'COFFEE', price: 110, stock: 100 },
    { name: 'Mocha (Hot)', category: 'COFFEE', price: 120, stock: 100 },
    { name: 'Iced Latte', category: 'COFFEE', price: 120, stock: 100 },
    { name: 'Caramel Macchiato', category: 'COFFEE', price: 120, stock: 100 },
  ];

  // Billiard Equipment (do not change anything here)
  const equipmentProducts = [
    { name: 'Cue Chalk', category: 'BILLIARD_EQUIPMENT', price: 25, stock: 30 },
    { name: 'Billiard Glove', category: 'BILLIARD_EQUIPMENT', price: 150, stock: 15 },
    { name: 'Cue Tip Replacement', category: 'BILLIARD_EQUIPMENT', price: 80, stock: 20 },
    { name: 'Triangle Rack', category: 'BILLIARD_EQUIPMENT', price: 200, stock: 10 },
  ];

  for (const product of menuProducts) {
    const id = makeProductId(product.name);
    await prisma.product.upsert({
      where: { id },
      update: {
        name: product.name,
        category: product.category,
        price: product.price,
        stock: product.stock,
        isActive: true,
      },
      create: { id, ...product, lowStockAt: 5, isActive: true },
    });
  }

  for (const product of equipmentProducts) {
    const id = makeProductId(product.name);
    await prisma.product.upsert({
      where: { id },
      update: {},
      create: { id, ...product, lowStockAt: 5, isActive: true },
    });
  }

  // Deactivate explicitly removed menu items
  const removedItems = [
    '3-in-1 Coffee',
  ];
  for (const name of removedItems) {
    const id = makeProductId(name);
    await prisma.product.updateMany({ where: { id }, data: { isActive: false } });
  }

  console.log('✅ Products seeded/updated (menu + equipment)');

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

