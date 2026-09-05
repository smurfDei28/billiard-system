const prisma = require('../config/prisma');
const { summarizeRevenue, buildDailyRevenue, isAcquireMockSandboxTopup } = require('../utils/revenueReporting');

const dateRange = (start) => {
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// These reports read independent data sets. Keeping them sequential prevents a
// single Admin request from occupying the complete Supabase session pool.
const reportData = async (startDate, endDate, db = prisma) => {
  const orders = await db.order.findMany({
    where: { createdAt: { gte: startDate, lt: endDate }, paymentStatus: 'PAID', status: { not: 'VOIDED' } },
    include: { items: { include: { product: true } } },
  });
  const topups = await db.creditTransaction.findMany({
    where: { createdAt: { gte: startDate, lt: endDate }, type: 'TOPUP' },
    select: { createdAt: true, amount: true, referenceNo: true },
  });
  const tournamentPayments = await db.manualPayment.findMany({
    where: { purpose: 'TOURNAMENT_ENTRY', status: 'APPROVED', reviewedAt: { gte: startDate, lt: endDate } },
    select: { createdAt: true, reviewedAt: true, amount: true, method: true },
  });
  const sessions = await db.tableSession.findMany({
    where: { createdAt: { gte: startDate, lt: endDate } },
    select: { createdAt: true, creditsUsed: true, status: true },
  });
  const walletTournamentFees = await db.creditTransaction.findMany({
    where: { createdAt: { gte: startDate, lt: endDate }, type: 'TOURNAMENT_FEE' },
    select: { createdAt: true, amount: true },
  });
  return [orders, topups, tournamentPayments, sessions, walletTournamentFees];
};

const getDashboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { end: tomorrow } = dateRange(today);
    const [totalMembers, activeSessionsCount, queueCount] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER' } }),
      prisma.tableSession.count({ where: { status: 'ACTIVE' } }),
      prisma.queueEntry.count({ where: { status: 'WAITING' } }),
    ]);
    const reportRows = await reportData(today, tomorrow);
    const [lowStockProducts, recentTransactions, topPlayers] = await Promise.all([
      prisma.product.findMany({ where: { stock: { lte: 5 }, isActive: true }, orderBy: { stock: 'asc' }, take: 5 }),
      prisma.creditTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { firstName: true, lastName: true } } } }),
      prisma.gamifiedProfile.findMany({ orderBy: { totalWins: 'desc' }, take: 5, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);
    const tableStatuses = await prisma.billiardTable.findMany({ orderBy: { tableNumber: 'asc' }, include: { sessions: { where: { status: 'ACTIVE' } }, queue: { where: { status: 'WAITING' } } } });
    const [orders, topups, tournamentPayments, sessions, walletTournamentFees] = reportRows;
    const revenue = summarizeRevenue({ orders, topups, tournamentPayments, sessions, walletTournamentFees });

    res.json({
      summary: {
        totalMembers, activeSessionsCount, queueCount,
        // `todayRevenue` is retained for existing clients and now consistently
        // means external cash collections, never wallet-credit consumption.
        todayRevenue: revenue.cashRevenue,
        todayCashRevenue: revenue.cashRevenue,
        todayPosSalesValue: revenue.posSalesValue,
        todayCashPosSales: revenue.cashPosSales,
        todayCreditPosSales: revenue.creditPosSales,
        todayTableUsageValue: revenue.tableUsageValue,
        todayCreditTopups: revenue.creditTopups,
        todayTournamentCashCollections: revenue.tournamentCashCollections,
        todayWalletTournamentFeeValue: revenue.walletTournamentFeeValue,
        todayTopups: topups.filter((transaction) => !isAcquireMockSandboxTopup(transaction)).length,
        todayTournamentFees: tournamentPayments.length,
        todayOrders: orders.length,
        todaySessions: sessions.length,
      },
      lowStockProducts, recentTransactions, topPlayers, tableStatuses,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
};

const getSalesReport = async (req, res) => {
  try {
    const days = Math.max(1, Number.parseInt(req.query.days, 10) || 7);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(0, 0, 0, 0);
    const [orders, topups, tournamentPayments, sessions, walletTournamentFees] = await reportData(startDate, endDate);
    const revenue = summarizeRevenue({ orders, topups, tournamentPayments, sessions, walletTournamentFees });
    const dailySales = buildDailyRevenue({ orders, topups, tournamentPayments, sessions, walletTournamentFees })
      .map((day) => ({ ...day, revenue: day.cashRevenue })); // compatibility for existing chart consumers

    const byCategory = {};
    orders.forEach((order) => order.items.forEach((item) => {
      const category = item.product.category;
      if (!byCategory[category]) byCategory[category] = { category, revenue: 0, quantity: 0 };
      byCategory[category].revenue += item.price * item.quantity;
      byCategory[category].quantity += item.quantity;
    }));

    res.json({
      dailySales,
      categoryBreakdown: Object.values(byCategory),
      // `totalRevenue` remains for clients but is now the single Cash Revenue definition.
      totalRevenue: revenue.cashRevenue,
      cashRevenueTotal: revenue.cashRevenue,
      posSalesValueTotal: revenue.posSalesValue,
      cashPosSalesTotal: revenue.cashPosSales,
      creditPosSalesTotal: revenue.creditPosSales,
      creditTopupsTotal: revenue.creditTopups,
      tournamentCashCollectionsTotal: revenue.tournamentCashCollections,
      tableUsageValueTotal: revenue.tableUsageValue,
      walletTournamentFeeValueTotal: revenue.walletTournamentFeeValue,
      totalOrders: orders.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

module.exports = { getDashboard, getSalesReport, reportData };
