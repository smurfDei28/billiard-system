const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { summarizeRevenue } = require('../utils/revenueReporting');

// Get all staff actions log (admin only)
router.get('/actions', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { limit = 50, staffId } = req.query;
    const actions = await prisma.staffAction.findMany({
      where: staffId ? { staffId: String(staffId) } : {},
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      include: { staff: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    res.json(actions);
  } catch { res.status(500).json({ error: 'Failed to fetch staff actions' }); }
});

// Get all staff members
router.get('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['STAFF', 'ADMIN'] } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true,
        staffActions: { take: 1, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(staff);
  } catch { res.status(500).json({ error: 'Failed to fetch staff' }); }
});

// Promote/demote user role (admin only)
router.patch('/:userId/role', authenticate, authorize('ADMIN'), async (req, res) => {
  const { role } = req.body;
  if (!['MEMBER', 'STAFF', 'ADMIN'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const user = await prisma.user.update({ where: { id: req.params.userId }, data: { role } });
    const { password, ...safe } = user;
    res.json(safe);
  } catch { res.status(500).json({ error: 'Failed to update role' }); }
});

// Get daily report
router.get('/daily-report', authenticate, authorize('ADMIN', 'STAFF'), async (req, res) => {
  try {
    const { date } = req.query;
    const start = date ? new Date(String(date)) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    const [sessions, orders, topups, tournamentPayments, walletTournamentFees, newMembers, queueTotal] = await Promise.all([
      prisma.tableSession.findMany({ where: { createdAt: { gte: start, lte: end } }, include: { table: true } }),
      prisma.order.findMany({ where: { createdAt: { gte: start, lte: end }, paymentStatus: 'PAID', status: { not: 'VOIDED' } }, include: { items: { include: { product: true } } } }),
      prisma.creditTransaction.findMany({ where: { type: 'TOPUP', createdAt: { gte: start, lte: end } } }),
      prisma.manualPayment.findMany({ where: { purpose: 'TOURNAMENT_ENTRY', status: 'APPROVED', reviewedAt: { gte: start, lte: end } }, select: { amount: true, createdAt: true, reviewedAt: true } }),
      prisma.creditTransaction.findMany({ where: { type: 'TOURNAMENT_FEE', createdAt: { gte: start, lte: end } }, select: { amount: true, createdAt: true } }),
      prisma.user.count({ where: { role: 'MEMBER', createdAt: { gte: start, lte: end } } }),
      prisma.queueEntry.count({ where: { joinedAt: { gte: start, lte: end } } }),
    ]);

    const revenue = summarizeRevenue({ orders, topups, tournamentPayments, sessions, walletTournamentFees });

    res.json({
      date: start.toISOString().split('T')[0],
      // Same definition as /api/analytics: external money collected once.
      totalRevenue: revenue.cashRevenue,
      cashRevenue: revenue.cashRevenue,
      posSalesValue: revenue.posSalesValue,
      cashPosSales: revenue.cashPosSales,
      creditPosSales: revenue.creditPosSales,
      tableUsageValue: revenue.tableUsageValue,
      creditTopups: revenue.creditTopups,
      tournamentCashCollections: revenue.tournamentCashCollections,
      walletTournamentFeeValue: revenue.walletTournamentFeeValue,
      sessionsCount: sessions.filter(s => s.status === 'ENDED').length,
      activeSessionsCount: sessions.filter(s => s.status === 'ACTIVE').length,
      ordersCount: orders.length,
      newMembersCount: newMembers,
      queueEntries: queueTotal,
      topSellingItems: Object.entries(
        orders.flatMap(o => o.items).reduce((acc, item) => {
          acc[item.product.name] = (acc[item.product.name] || 0) + item.quantity;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 5),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to generate report' }); }
});

module.exports = router;
