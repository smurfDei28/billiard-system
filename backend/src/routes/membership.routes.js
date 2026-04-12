// ─── membership.routes.js ───
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/me', authenticate, async (req, res) => {
  const membership = await prisma.membership.findUnique({ where: { userId: req.user.id } });
  res.json(membership);
});

router.patch('/plan', authenticate, authorize('ADMIN'), async (req, res) => {
  const { userId, plan } = req.body;
  const updated = await prisma.membership.update({ where: { userId }, data: { plan } });
  res.json(updated);
});

module.exports = router;
