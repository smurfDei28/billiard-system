const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const prisma = require('../src/config/prisma');
const { setProductActive, updateProduct } = require('../src/controllers/pos.controller');

const response = () => {
  const state = { statusCode: 200, body: null };
  return { state, status(code) { state.statusCode = code; return this; }, json(body) { state.body = body; return this; } };
};

const withProductDb = async (run) => {
  const original = { transaction: prisma.$transaction };
  const product = { id: 'product-1', name: 'Sprite', category: 'DRINKS', price: 30, costPrice: 20, stock: 12, lowStockAt: 3, isActive: true };
  const orderItem = { productId: product.id, price: 30, quantity: 1 };
  let stockHistoryWrites = 0;
  const tx = {
    product: {
      findUnique: async () => ({ ...product }),
      update: async ({ data }) => Object.assign(product, data),
    },
    staffAction: { create: async () => ({}) },
    stockHistory: { create: async () => { stockHistoryWrites += 1; } },
  };
  prisma.$transaction = async (callback) => callback(tx);
  try { await run({ product, orderItem, stockHistoryWrites: () => stockHistoryWrites }); }
  finally { prisma.$transaction = original.transaction; }
};

const request = (body) => ({ body, params: { productId: 'product-1' }, user: { id: 'staff-1' }, app: { get: () => null } });

test('metadata edit preserves stock, stock history, and historical OrderItem price', async () => {
  await withProductDb(async ({ product, orderItem, stockHistoryWrites }) => {
    const res = response();
    await updateProduct(request({ name: 'Sprite 500ml', category: 'DRINKS', price: 35, costPrice: 22, lowStockAt: 4 }), res);
    assert.equal(res.state.statusCode, 200);
    assert.equal(product.name, 'Sprite 500ml');
    assert.equal(product.price, 35);
    assert.equal(product.costPrice, 22);
    assert.equal(product.lowStockAt, 4);
    assert.equal(product.stock, 12);
    assert.equal(stockHistoryWrites(), 0);
    assert.equal(orderItem.price, 30);
  });
});

test('product edit rejects stock mutation and invalid prices, while activation preserves stock', async () => {
  await withProductDb(async ({ product, stockHistoryWrites }) => {
    const stockAttempt = response();
    await updateProduct(request({ name: 'Sprite', category: 'DRINKS', price: 30, costPrice: 20, lowStockAt: 3, stock: 99 }), stockAttempt);
    assert.equal(stockAttempt.state.statusCode, 400);
    assert.equal(product.stock, 12);

    const negative = response();
    await updateProduct(request({ name: 'Sprite', category: 'DRINKS', price: -1, costPrice: 20, lowStockAt: 3 }), negative);
    assert.equal(negative.state.statusCode, 400);

    const deactivate = response();
    await setProductActive(request({ isActive: false }), deactivate);
    assert.equal(deactivate.state.statusCode, 200);
    assert.equal(product.isActive, false);
    assert.equal(product.stock, 12);

    const reactivate = response();
    await setProductActive(request({ isActive: true }), reactivate);
    assert.equal(reactivate.state.statusCode, 200);
    assert.equal(product.isActive, true);
    assert.equal(product.stock, 12);
    assert.equal(stockHistoryWrites(), 0);
  });
});

test('product metadata and activation routes remain restricted to Staff and Admin', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'product.routes.js'), 'utf8');
  assert.match(source, /router\.patch\('\/:productId', authenticate, authorize\('STAFF', 'ADMIN'\), updateProduct\)/);
  assert.match(source, /router\.patch\('\/:productId\/active', authenticate, authorize\('STAFF', 'ADMIN'\), setProductActive\)/);
});
