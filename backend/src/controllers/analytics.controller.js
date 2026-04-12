const prisma = require('../config/prisma');

const getDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalMembers,
      activeSessionsCount,
      todayOrders,
      todaySessions,
      lowStockProducts,
      recentTransactions,
      topPlayers,
      tableStatuses,
      queueCount,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER' } }),
      prisma.tableSession.count({ where: { status: 'ACTIVE' } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.tableSession.aggregate({
        where: { createdAt: { gte: today, lt: tomorrow } },
        _sum: { creditsUsed: true },
        _count: true,
      }),
      prisma.product.findMany({
        where: { stock: { lte: 5 }, isActive: true },
        orderBy: { stock: 'asc' },
        take: 5,
      }),
      prisma.creditTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.gamifiedProfile.findMany({
        orderBy: { totalWins: 'desc' },
        take: 5,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.billiardTable.findMany({
        orderBy: { tableNumber: 'asc' },
        include: {
          sessions: { where: { status: 'ACTIVE' } },
          queue: { where: { status: 'WAITING' } },
        },
      }),
      prisma.queueEntry.count({ where: { status: 'WAITING' } }),
    ]);

    const todayRevenue = (todayOrders._sum.total || 0) + (todaySessions._sum.creditsUsed || 0);

    res.json({
      summary: {
        totalMembers,
        activeSessionsCount,
        todayRevenue,
        todayOrders: todayOrders._count,
        todaySessions: todaySessions._count,
        queueCount,
      },
      lowStockProducts,
      recentTransactions,
      topPlayers,
      tableStatuses,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
};

const getSalesReport = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: startDate } },
      include: { items: { include: { product: true } } },
    });

    // Group by day
    const byDay = {};
    orders.forEach((order) => {
      const day = order.createdAt.toISOString().split('T')[0];
      if (!byDay[day]) byDay[day] = { date: day, revenue: 0, orders: 0 };
      byDay[day].revenue += order.total;
      byDay[day].orders += 1;
    });

    // Category breakdown
    const byCategory = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const cat = item.product.category;
        if (!byCategory[cat]) byCategory[cat] = { category: cat, revenue: 0, quantity: 0 };
        byCategory[cat].revenue += item.price * item.quantity;
        byCategory[cat].quantity += item.quantity;
      });
    });

    res.json({
      dailySales: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      categoryBreakdown: Object.values(byCategory),
      totalRevenue: orders.reduce((s, o) => s + o.total, 0),
      totalOrders: orders.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

module.exports = { getDashboard, getSalesReport };
