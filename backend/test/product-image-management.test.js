const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const storage = require('../src/services/productImageStorage.service');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'product.routes.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'pos.controller.js'), 'utf8');
const shopSource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'member', 'ShopScreen.tsx'), 'utf8');
const inventorySource = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'screens', 'staff', 'InventoryScreen.tsx'), 'utf8');

test('product image upload uses a dedicated public Supabase bucket and stable public URL', async (t) => {
  const originals = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
    bucket: process.env.PRODUCT_IMAGE_BUCKET,
    fetch: global.fetch,
  };
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.PRODUCT_IMAGE_BUCKET = 'product-images-test';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  t.after(() => {
    global.fetch = originals.fetch;
    const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
    restore('SUPABASE_URL', originals.url);
    restore('SUPABASE_SERVICE_KEY', originals.key);
    restore('PRODUCT_IMAGE_BUCKET', originals.bucket);
  });

  const result = await storage.uploadProductImage('red-horse', { mimetype: 'image/jpeg', buffer: Buffer.from('image') });
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].options.method, 'POST');
  assert.match(calls[1].url, /\/storage\/v1\/bucket$/);
  assert.equal(JSON.parse(calls[1].options.body).public, true);
  assert.equal(calls[2].options.method, 'POST');
  assert.match(result.publicUrl, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/product-images-test\/red-horse\/.+\.jpg$/);
});

test('only Staff and Admin can replace a product image and the previous stored image is cleaned up', () => {
  assert.match(routeSource, /router\.post\('\/:productId\/image', authenticate, authorize\('STAFF', 'ADMIN'\)/);
  assert.match(routeSource, /limits: \{ fileSize: MAX_IMAGE_BYTES, files: 1 \}/);
  assert.match(controllerSource, /data: \{ imageUrl: uploaded\.publicUrl \}/);
  assert.match(controllerSource, /action: 'PRODUCT_IMAGE_UPDATED'/);
  assert.match(controllerSource, /removeProductImage\(existing\.imageUrl\)/);
});

test('member Shop uses compact responsive cards and never substitutes one category photo for multiple products', () => {
  assert.match(shopSource, /numColumns=\{columns\}/);
  assert.match(shopSource, /width: cardWidth/);
  assert.match(shopSource, /product\.imageUrl/);
  assert.match(shopSource, /Photo coming soon/);
  assert.doesNotMatch(shopSource, /categoryImages|assets\/products/);
});

test('Staff can choose or capture an exact photo for new and existing products', () => {
  assert.match(inventorySource, /Product Photo/);
  assert.match(inventorySource, /Use a clear photo of this exact item/);
  assert.match(inventorySource, /launchImageLibraryAsync/);
  assert.match(inventorySource, /launchCameraAsync/);
  assert.match(inventorySource, /ImageManipulator\.manipulateAsync/);
  assert.match(inventorySource, /resize: \{ width: 1280 \}/);
  assert.match(inventorySource, /format: ImageManipulator\.SaveFormat\.JPEG/);
  assert.match(inventorySource, /mimeType: 'image\/jpeg'/);
  assert.match(inventorySource, /\/api\/products\/\$\{encodeURIComponent\(productId\)\}\/image/);
  assert.match(inventorySource, /if \(!newImage\).*Product photo required/);
  assert.match(inventorySource, /if \(!editingProduct\.imageUrl && !editImage\).*Product photo required/);
});

test('Staff product editing reports image-only failures without claiming the details were lost', () => {
  assert.match(inventorySource, /Product details saved/);
  assert.match(inventorySource, /details were saved, but the photo could not be uploaded/);
  assert.match(inventorySource, /error\?\.response\?\.data\?\.error \|\| error\?\.message/);
});
