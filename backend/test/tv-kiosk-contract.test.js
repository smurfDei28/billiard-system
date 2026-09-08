const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const kioskSource = fs.readFileSync(path.join(__dirname, '..', '..', 'tv-kiosk', 'app.js'), 'utf8');
const kioskHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tv-kiosk', 'index.html'), 'utf8');

test('browser TV origin is explicitly added without disabling existing CORS restrictions', () => {
  assert.match(backendSource, /process\.env\.TV_KIOSK_ORIGIN/);
  assert.match(backendSource, /const corsOrigin = browserOrigins\.length \? browserOrigins : '\*'/);
  assert.match(backendSource, /app\.use\(cors\(\{ origin: corsOrigin, credentials: true \}\)\)/);
});

test('TV kiosk uses existing authentication and exposes no write controls', () => {
  assert.match(kioskSource, /\/api\/auth\/login/);
  assert.match(kioskSource, /\['STAFF', 'ADMIN'\]\.includes/);
  assert.match(kioskSource, /sessionStorage\.setItem\('tvAccessToken'/);
  assert.match(kioskSource, /Promise\.all\(\[request\('\/api\/tables'\), request\('\/api\/queue'\), request\('\/api\/tournaments'\)\]\)/);
  assert.doesNotMatch(kioskSource, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/);
  assert.doesNotMatch(kioskHtml, /start session|complete match|approve reservation/i);
});

test('TV clock and all displayed schedules are explicitly formatted in Philippine time', () => {
  assert.match(kioskSource, /const PH_ZONE = 'Asia\/Manila'/);
  assert.match(kioskSource, /timeZone: PH_ZONE/);
  assert.match(kioskHtml, /id="fullscreen"/);
});
