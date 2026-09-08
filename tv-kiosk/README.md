# Saturday Nights Browser TV Kiosk

This is a static, read-only display for a Smart TV browser, Android TV box,
mini PC, or laptop connected through HDMI. It uses the existing authenticated
backend APIs and stores credentials only in the current browser session.

## Local test

1. Set `TV_KIOSK_ORIGIN=http://localhost:4173` in `backend/.env`.
2. Restart the backend so the CORS change takes effect.
3. From this directory, run `npx serve -l 4173` (or any static file server).
4. Open `http://localhost:4173`, then sign in with a dedicated Staff account.

## Deployment

Upload this entire folder to a new Netlify site. Attach a domain such as
`display.saturdaynightsbilliard.online`, then set Railway's
`TV_KIOSK_ORIGIN` to that exact HTTPS origin and redeploy the backend.

The production API URL and refresh interval are configured in `config.js`.
No password or API secret belongs in that file.
