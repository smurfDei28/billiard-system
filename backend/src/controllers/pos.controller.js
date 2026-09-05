const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { awardSpendReward } = require('../utils/creditLifecycle');

const POS_PAYMENT_METHODS = ['CASH', 'GCASH', 'MAYA', 'LOYALTY_CREDIT'];
const PRODUCT_CATEGORIES = ['RICE_MEAL', 'DRINKS', 'ALCOHOLIC_BEVERAGES', 'COFFEE', 'BILLIARD_EQUIPMENT', 'SNACKS'];
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const receiptNumber = (id, now = new Date()) => `SNB-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;

const getProducts = async (req, res) => {
  try {
    const { category } = req.query;
    const products = await prisma.product.findMany({ where: { isActive: true, ...(category && { category }) }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    res.json(products);
  } catch { res.status(500).json({ error: 'Failed to fetch products' }); }
};

const createProduct = async (req, res) => {
  const { name, category, price, costPrice, stock, lowStockAt } = req.body;
  if (!name || !category || !Number.isFinite(Number(price)) || Number(price) < 0) return res.status(400).json({ error: 'name, category, and a valid selling price are required' });
  if (Number(costPrice || 0) < 0 || Number(stock || 0) < 0 || Number(lowStockAt ?? 5) < 0) return res.status(400).json({ error: 'Cost, stock, and low-stock threshold cannot be negative' });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { name: String(name).trim(), category, price: money(price), costPrice: money(costPrice || 0), stock: Number.parseInt(stock, 10) || 0, lowStockAt: Number.parseInt(lowStockAt, 10) || 0 } });
      if (created.stock > 0) await tx.stockHistory.create({ data: { productId: created.id, change: created.stock, reason: 'INITIAL_STOCK', staffId: req.user.id, stockBefore: 0, stockAfter: created.stock } });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: 'PRODUCT_CREATED', targetId: created.id, details: { name: created.name, stock: created.stock } } });
      return created;
    });
    res.status(201).json(product);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create product' }); }
};

const productMetadata = (body) => {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const price = Number(body.price);
  const costPrice = Number(body.costPrice);
  const lowStockAt = Number(body.lowStockAt);

  if (!name || name.length > 120) throw Object.assign(new Error('Product name is required and must be 120 characters or fewer.'), { status: 400 });
  if (!PRODUCT_CATEGORIES.includes(category)) throw Object.assign(new Error('Choose a valid product category.'), { status: 400 });
  if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error('Selling price must be a valid non-negative amount.'), { status: 400 });
  if (!Number.isFinite(costPrice) || costPrice < 0) throw Object.assign(new Error('Cost price must be a valid non-negative amount.'), { status: 400 });
  if (!Number.isInteger(lowStockAt) || lowStockAt < 0) throw Object.assign(new Error('Low-stock threshold must be a non-negative whole number.'), { status: 400 });

  return { name, category, price: money(price), costPrice: money(costPrice), lowStockAt };
};

const updateProduct = async (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.body, 'stock')) {
    return res.status(400).json({ error: 'Current stock must be changed through Restock or Adjustment.' });
  }

  let data;
  try {
    data = productMetadata(req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: req.params.productId } });
      if (!existing) throw Object.assign(new Error('Product not found.'), { status: 404 });
      const updated = await tx.product.update({ where: { id: existing.id }, data });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: 'PRODUCT_UPDATED', targetId: updated.id, details: { name: updated.name, category: updated.category, price: updated.price, costPrice: updated.costPrice, lowStockAt: updated.lowStockAt } } });
      return updated;
    });
    req.app.get('io')?.to('staff-tablet').emit('inventory:updated', { product });
    res.json(product);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to update product.' });
  }
};

const setProductActive = async (req, res) => {
  if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false.' });

  try {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: req.params.productId } });
      if (!existing) throw Object.assign(new Error('Product not found.'), { status: 404 });
      if (existing.isActive === req.body.isActive) return existing;
      const updated = await tx.product.update({ where: { id: existing.id }, data: { isActive: req.body.isActive } });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: updated.isActive ? 'PRODUCT_REACTIVATED' : 'PRODUCT_DEACTIVATED', targetId: updated.id, details: { name: updated.name, isActive: updated.isActive } } });
      return updated;
    });
    req.app.get('io')?.to('staff-tablet').emit('inventory:updated', { product });
    res.json(product);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to update product status.' });
  }
};

const updateStock = async (req, res) => {
  const { change, reason } = req.body;
  const quantity = Number.parseInt(change, 10);
  if (!Number.isInteger(quantity) || quantity === 0 || !String(reason || '').trim()) return res.status(400).json({ error: 'A non-zero whole-number change and reason are required' });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: req.params.productId } });
      if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
      if (product.stock + quantity < 0) throw Object.assign(new Error('Stock cannot go below 0'), { status: 400 });
      const changed = await tx.product.update({ where: { id: product.id }, data: { stock: { increment: quantity } } });
      await tx.stockHistory.create({ data: { productId: product.id, change: quantity, reason: String(reason).trim(), staffId: req.user.id, stockBefore: product.stock, stockAfter: changed.stock } });
      await tx.staffAction.create({ data: { staffId: req.user.id, action: quantity > 0 ? 'INVENTORY_ADD' : 'INVENTORY_MINUS', targetId: product.id, details: { change: quantity, reason: String(reason).trim(), stockBefore: product.stock, stockAfter: changed.stock } } });
      return changed;
    });
    if (updated.stock <= updated.lowStockAt) req.app.get('io')?.to('staff-tablet').emit('inventory:lowStock', { product: updated, message: `Low stock alert: ${updated.name} only has ${updated.stock} left` });
    res.json(updated);
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Failed to update stock' }); }
};

const getInventoryReport = async (_req, res) => {
  try {
    const products = await prisma.product.findMany({ include: { stockHistory: { orderBy: { createdAt: 'desc' }, take: 5 } }, orderBy: [{ isActive: 'desc' }, { stock: 'asc' }] });
    const lowStock = products.filter((product) => product.isActive && product.stock > 0 && product.stock <= product.lowStockAt);
    const outOfStock = products.filter((product) => product.isActive && product.stock === 0);
    res.json({ products, lowStock, outOfStock, lowStockCount: lowStock.length, outOfStockCount: outOfStock.length, totalProducts: products.length, inventoryValue: products.reduce((sum, product) => sum + money(product.costPrice) * product.stock, 0) });
  } catch { res.status(500).json({ error: 'Failed to fetch inventory' }); }
};

const getStockMovements = async (req, res) => {
  try {
    const where = { ...(req.query.productId && { productId: String(req.query.productId) }), ...(req.query.reason && { reason: String(req.query.reason) }) };
    const movements = await prisma.stockHistory.findMany({ where, include: { product: { select: { id: true, name: true, category: true } } }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(req.query.limit) || 100) });
    res.json(movements);
  } catch { res.status(500).json({ error: 'Failed to fetch stock movements' }); }
};

const normalizeItems = (items) => {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('Order must have at least one item'), { status: 400 });
  const quantities = new Map();
  items.forEach((item) => {
    const quantity = Number(item.quantity);
    if (!item.productId || !Number.isInteger(quantity) || quantity <= 0) throw Object.assign(new Error('Each order item must include a valid productId and quantity'), { status: 400 });
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + quantity);
  });
  return [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
};

const createOrder = async (req, res) => {
  const { userId, walkinName, paymentMethod, paidWithCredits, amountTendered } = req.body;
  let items;
  try { items = normalizeItems(req.body.items); } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
  const normalizedMethod = paymentMethod === 'CREDITS' || paidWithCredits ? 'LOYALTY_CREDIT' : String(paymentMethod || 'CASH').toUpperCase();
  if (!POS_PAYMENT_METHODS.includes(normalizedMethod)) return res.status(400).json({ error: 'Choose Cash, Credits, GCash, or Maya. Card is not supported.' });
  if (normalizedMethod === 'LOYALTY_CREDIT' && !userId) return res.status(400).json({ error: 'Credits payment requires a registered member.' });

  try {
    const order = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: items.map((item) => item.productId) }, isActive: true } });
      if (products.length !== items.length) throw Object.assign(new Error('One or more products are unavailable'), { status: 404 });
      const subtotal = money(items.reduce((sum, item) => sum + money(products.find((product) => product.id === item.productId).price) * item.quantity, 0));
      const tendered = normalizedMethod === 'CASH' ? money(amountTendered) : null;
      if (normalizedMethod === 'CASH' && (!Number.isFinite(tendered) || tendered < subtotal)) throw Object.assign(new Error(`Amount tendered must be at least ${subtotal.toFixed(2)}.`), { status: 400 });

      let membership = null;
      if (normalizedMethod === 'LOYALTY_CREDIT') {
        membership = await tx.membership.findUnique({ where: { userId } });
        if (!membership || Number(membership.creditBalance) < subtotal) throw Object.assign(new Error('Insufficient credits'), { status: 400 });
      }

      const id = randomUUID();
      const created = await tx.order.create({
        data: { id, receiptNumber: receiptNumber(id), userId: userId || null, walkinName: walkinName?.trim() || null, subtotal, total: subtotal, amountTendered: tendered, changeDue: tendered == null ? null : money(tendered - subtotal), paymentMethod: normalizedMethod, paidWithCredits: normalizedMethod === 'LOYALTY_CREDIT', staffId: req.user.id, items: { create: items.map((item) => ({ productId: item.productId, quantity: item.quantity, price: products.find((product) => product.id === item.productId).price })) } },
        include: { items: { include: { product: true } }, user: { select: { id: true, firstName: true, lastName: true } } },
      });

      for (const item of items) {
        const claim = await tx.product.updateMany({ where: { id: item.productId, isActive: true, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
        if (claim.count !== 1) throw Object.assign(new Error(`This product is no longer available or has insufficient stock: ${products.find((product) => product.id === item.productId).name}`), { status: 409 });
        const after = await tx.product.findUnique({ where: { id: item.productId } });
        await tx.stockHistory.create({ data: { productId: item.productId, change: -item.quantity, reason: 'SALE', staffId: req.user.id, stockBefore: after.stock + item.quantity, stockAfter: after.stock } });
      }
      if (membership) {
        const updated = await tx.membership.update({ where: { userId }, data: { creditBalance: { decrement: subtotal } } });
        await tx.creditTransaction.create({ data: { userId, type: 'DEDUCTION', amount: subtotal, balanceBefore: membership.creditBalance, balanceAfter: updated.creditBalance, description: `POS receipt ${created.receiptNumber}` } });
      }
      await tx.staffAction.create({ data: { staffId: req.user.id, action: 'POS_ORDER_CREATED', targetId: created.id, details: { receiptNumber: created.receiptNumber, total: subtotal, paymentMethod: normalizedMethod } } });
      return created;
    });
    if (userId) awardSpendReward(userId, prisma).catch((err) => console.error('[awardSpendReward][POS]', err?.message || err));
    req.app.get('io')?.to('staff-tablet').emit('order:created', order);
    res.status(201).json(order);
  } catch (err) { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Failed to create order' }); }
};

const getOrders = async (req, res) => {
  try {
    const where = {};
    if (req.query.date) { const start = new Date(String(req.query.date)); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); where.createdAt = { gte: start, lt: end }; }
    if (req.query.paymentMethod) where.paymentMethod = String(req.query.paymentMethod);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.q) where.OR = [{ receiptNumber: { contains: String(req.query.q), mode: 'insensitive' } }, { walkinName: { contains: String(req.query.q), mode: 'insensitive' } }, { user: { email: { contains: String(req.query.q), mode: 'insensitive' } } }, { user: { firstName: { contains: String(req.query.q), mode: 'insensitive' } } }];
    const orders = await prisma.order.findMany({ where, include: { items: { include: { product: true } }, user: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ orders, total: orders.filter((order) => order.status !== 'VOIDED' && order.paymentStatus === 'PAID').reduce((sum, order) => sum + order.total, 0), count: orders.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch orders' }); }
};

const voidOrder = async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A void reason is required' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: req.params.orderId }, include: { items: true } });
      if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
      if (order.status === 'VOIDED') return { order, alreadyVoided: true };
      const wasPaid = order.paymentStatus === 'PAID';
      const updated = await tx.order.update({ where: { id: order.id }, data: { status: 'VOIDED', fulfillmentStatus: 'CANCELLED', paymentStatus: wasPaid ? 'REFUNDED' : order.paymentStatus, voidReason: reason, voidedAt: new Date(), voidedBy: req.user.id } });
      if (wasPaid) for (const item of order.items) {
        const product = await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        await tx.stockHistory.create({ data: { productId: item.productId, change: item.quantity, reason: `VOID: ${reason}`, staffId: req.user.id, stockBefore: product.stock - item.quantity, stockAfter: product.stock } });
      }
      if (wasPaid && order.paidWithCredits && order.userId) {
        const membership = await tx.membership.findUnique({ where: { userId: order.userId } });
        const updatedMembership = await tx.membership.update({ where: { userId: order.userId }, data: { creditBalance: { increment: order.total } } });
        await tx.creditTransaction.create({ data: { userId: order.userId, type: 'REFUND', amount: order.total, balanceBefore: membership.creditBalance, balanceAfter: updatedMembership.creditBalance, description: `POS void refund: ${order.receiptNumber || order.id}` } });
      }
      await tx.staffAction.create({ data: { staffId: req.user.id, action: 'POS_ORDER_VOIDED', targetId: order.id, details: { receiptNumber: order.receiptNumber, reason, paymentMethod: order.paymentMethod, manualRefundRequired: !order.paidWithCredits } } });
      return { order: updated, alreadyVoided: false };
    });
    res.json({ ...result, manualRefundRequired: !result.order.paidWithCredits });
  } catch (err) { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Failed to void order' }); }
};

module.exports = { POS_PAYMENT_METHODS, PRODUCT_CATEGORIES, receiptNumber, normalizeItems, getProducts, createProduct, updateProduct, setProductActive, updateStock, getInventoryReport, getStockMovements, createOrder, getOrders, voidOrder };
