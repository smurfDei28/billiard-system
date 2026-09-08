const { randomUUID } = require('crypto');

const DEFAULT_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const settings = () => {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const bucket = String(process.env.PRODUCT_IMAGE_BUCKET || DEFAULT_BUCKET).trim();
  if (!baseUrl || !serviceKey || !bucket) throw Object.assign(new Error('Product image storage is not configured.'), { status: 503 });
  return { baseUrl, serviceKey, bucket };
};

const objectUrl = ({ baseUrl, bucket }, objectKey, isPublic = false) =>
  `${baseUrl}/storage/v1/object/${isPublic ? 'public/' : ''}${[bucket, ...objectKey.split('/')].map(encodeURIComponent).join('/')}`;
const bucketUrl = ({ baseUrl }, bucket) => `${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
const authHeaders = (serviceKey) => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });

const ensurePublicBucket = async (storage) => {
  const current = await fetch(bucketUrl(storage, storage.bucket), { headers: authHeaders(storage.serviceKey) });
  const bucketResponse = typeof current.json === 'function' ? await current.json().catch(() => ({})) : {};
  if (current.ok) {
    if (bucketResponse.public === true) return;
    const updated = await fetch(bucketUrl(storage, storage.bucket), {
      method: 'PUT',
      headers: { ...authHeaders(storage.serviceKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: true, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: Object.keys(MIME_EXTENSIONS) }),
    });
    if (!updated.ok) throw Object.assign(new Error('Product image storage must be public.'), { status: 502 });
    return;
  }
  // Supabase Storage currently returns HTTP 400 with a nested 404/NoSuchBucket
  // payload when a bucket does not exist. Treat both response shapes as missing
  // so the existing automatic bucket creation can run.
  const isMissingBucket = current.status === 404
    || String(bucketResponse.statusCode || '') === '404'
    || bucketResponse.code === 'NoSuchBucket';
  if (!isMissingBucket) throw Object.assign(new Error('Product image storage could not be checked.'), { status: 502 });
  const created = await fetch(`${storage.baseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...authHeaders(storage.serviceKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: storage.bucket, name: storage.bucket, public: true, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: Object.keys(MIME_EXTENSIONS) }),
  });
  if (!created.ok && created.status !== 409) throw Object.assign(new Error('Product image storage could not be prepared.'), { status: 502 });
};

const uploadProductImage = async (productId, file) => {
  const extension = MIME_EXTENSIONS[file?.mimetype];
  if (!extension || !file?.buffer?.length) throw Object.assign(new Error('Choose a JPEG, PNG, or WebP product image.'), { status: 400 });
  const storage = settings();
  await ensurePublicBucket(storage);
  const objectKey = `${productId}/${Date.now()}-${randomUUID()}.${extension}`;
  const response = await fetch(objectUrl(storage, objectKey), {
    method: 'POST',
    headers: { ...authHeaders(storage.serviceKey), 'Content-Type': file.mimetype, 'Cache-Control': '3600', 'x-upsert': 'false' },
    body: file.buffer,
  });
  if (!response.ok) throw Object.assign(new Error('Product image upload failed.'), { status: 502 });
  return { objectKey, publicUrl: objectUrl(storage, objectKey, true) };
};

const storedObjectKey = (url) => {
  const storage = settings();
  const prefix = objectUrl(storage, '', true);
  if (!String(url || '').startsWith(prefix)) return null;
  return decodeURIComponent(String(url).slice(prefix.length));
};

const removeProductImage = async (url) => {
  const storage = settings();
  const objectKey = storedObjectKey(url);
  if (!objectKey) return false;
  const response = await fetch(objectUrl(storage, objectKey), { method: 'DELETE', headers: authHeaders(storage.serviceKey) });
  if (!response.ok && response.status !== 404) throw new Error('Previous product image could not be removed.');
  return true;
};

module.exports = { DEFAULT_BUCKET, MAX_IMAGE_BYTES, MIME_EXTENSIONS, uploadProductImage, removeProductImage, _test: { settings, objectUrl, ensurePublicBucket, storedObjectKey } };
