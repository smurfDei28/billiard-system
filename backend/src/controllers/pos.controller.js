const prisma = require('../config/prisma');

// ─── PRODUCTS ───
const getProducts = async (req, res) => {
  try {
    const { category } = req.query;
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(category && { category }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

const createProduct = async (req, res) => {
  const { name, category, price, stock, lowStockAt } = req.body;
  if (!name || !category || !price) {
    return res.status(400).json({ error: 'name, category, and price are required' });
  }
  try {
    const product = await prisma.product.create({
      data: { name, category, price, stock: stock || 0, lowStockAt: lowStockAt || 5 },
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create product' });
  }
};

const updateStock = async (req, res) => {
  const { productId } = req.params;
  const { change, reason } = req.body;

  if (!change || !reason) {
    return res.status(400).json({ error: 'change (number) and reason are required' });
  }

  try {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const newStock = product.stock + change;
    if (newStock < 0) return res.status(400).json({ error: 'Stock cannot go below 0' });

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id: productId },
        data: { stock: newStock },
      });
      await tx.stockHistory.create({
        data: { productId, change, reason, staffId: req.user.id },
      });
      await tx.staffAction.create({
        data: {
          staffId: req.user.id,
          action: change > 0 ? 'INVENTORY_ADD' : 'INVENTORY_MINUS',
          targetId: productId,
          details: { change, reason, newStock },
        },
      });
      return p;
    });

    // Low stock alert
    if (updated.stock <= updated.lowStockAt) {
      const io = req.app.get('io');
      io.to('staff-tablet').emit('inventory:lowStock', {
        product: updated,
        message: `Low stock alert: ${updated.name} only has ${updated.stock} left`,
      });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
};

const getInventoryReport = async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: {
        stockHistory: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { stock: 'asc' },
    });

    const lowStock = products.filter((p) => p.stock <= p.lowStockAt);
    res.json({ products, lowStock, lowStockCount: lowStock.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
};

// ─── ORDERS / POS ───
const createOrder = async (req, res) => {
  const { items, userId, walkinName, paymentMethod, paidWithCredits } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  try {
    // Validate all products exist and have enough stock
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return res.status(404).json({ error: `Product not found: ${item.productId}` });
      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for: ${product.name}` });
      }
    }

    const total = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      return sum + product.price * item.quantity;
    }, 0);

    // If paying with credits, check balance
    if (paidWithCredits && userId) {
      const membership = await prisma.membership.findUnique({ where: { userId } });
      if (!membership || membership.creditBalance < total) {
        return res.status(400).json({ error: 'Insufficient credits' });
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          userId: userId || null,
          walkinName: walkinName || null,
          total,
          paymentMethod: paymentMethod || 'CASH',
          paidWithCredits: paidWithCredits || false,
          staffId: req.user.id,
          items: {
            create: items.map((item) => {
              const product = products.find((p) => p.id === item.productId);
              return {
                productId: item.productId,
                quantity: item.quantity,
                price: product.price,
              };
            }),
          },
        },
        include: { items: { include: { product: true } } },
      });

      // Deduct stock
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
        await tx.stockHistory.create({
          data: {
            productId: item.productId,
            change: -item.quantity,
            reason: 'SALE',
            staffId: req.user.id,
          },
        });
      }

      // Deduct credits if paid with credits
      if (paidWithCredits && userId) {
        const membership = await tx.membership.findUnique({ where: { userId } });
        await tx.membership.update({
          where: { userId },
          data: { creditBalance: { decrement: total } },
        });
        await tx.creditTransaction.create({
          data: {
            userId,
            type: 'DEDUCTION',
            amount: total,
            balanceBefore: membership.creditBalance,
            balanceAfter: membership.creditBalance - total,
            description: `POS Order #${o.id.slice(0, 8)}`,
          },
        });
      }

      return o;
    });

    const io = req.app.get('io');
    io.to('staff-tablet').emit('order:created', order);

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

const getOrders = async (req, res) => {
  try {
    const { date } = req.query;
    const startOfDay = date ? new Date(date) : new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = orders.reduce((sum, o) => sum + o.total, 0);
    res.json({ orders, total, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

module.exports = { getProducts, createProduct, updateStock, getInventoryReport, createOrder, getOrders };
