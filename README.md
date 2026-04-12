# 🎱 Saturday Nights Billiard Hall Management System
## Complete Setup Guide

---

## 📁 Project Structure
```
billiard-system/
├── backend/          ← Node.js + Express API
│   ├── prisma/       ← Database schema (PostgreSQL)
│   └── src/
│       ├── controllers/  ← Business logic
│       ├── routes/       ← API endpoints
│       ├── middleware/   ← Auth, validation
│       ├── services/     ← Background services
│       └── utils/        ← Helpers, seed data
│
├── mobile/           ← React Native (Expo) App
│   └── src/
│       ├── screens/
│       │   ├── auth/     ← Login, Register
│       │   ├── member/   ← Member dashboard, profile, tournaments
│       │   ├── staff/    ← POS, inventory, credit top-up
│       │   ├── admin/    ← Analytics, management
│       │   └── tv/       ← TV display (queue + brackets)
│       ├── context/      ← Auth, Socket context
│       └── constants/    ← Colors, API config
│
└── sensor/           ← Raspberry Pi Python code (Module 7)
    ├── sensor.py     ← Main sensor script
    └── setup.sh      ← Auto-setup script
```

---

## ⚡ STEP 1: Set Up Supabase (Free Database)

1. Go to **https://supabase.com** → Sign up → New Project
2. Choose a name (e.g., `saturday-nights-billiard`)
3. Set a strong database password
4. Wait for setup (~2 minutes)
5. Go to **Settings → Database → Connection String (URI)**
6. Copy the connection string - you'll need it for `DATABASE_URL`
7. Also copy from **Settings → API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY`

---

## ⚡ STEP 2: Set Up Backend

### Install Node.js (if not installed)
Download from: https://nodejs.org (LTS version)

### Commands:
```bash
cd backend

# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env with your values (use any text editor)
# - Paste your DATABASE_URL from Supabase
# - Generate JWT secrets (run this in terminal):
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Copy the output → paste as JWT_SECRET
# Run again → paste as JWT_REFRESH_SECRET

# 4. Generate Prisma client
npm run db:generate

# 5. Push schema to Supabase database
npm run db:push

# 6. Seed initial data (tables, products, test accounts)
npm run db:seed

# 7. Start backend
npm run dev
```

### ✅ Backend is running when you see:
```
🎱 Billiard Hall API running on port 3000
📡 WebSocket server ready
```

---

## ⚡ STEP 3: Set Up Mobile App

### Install Expo CLI:
```bash
npm install -g expo-cli
```

### Install Expo Go on your phone:
- **Android:** Search "Expo Go" on Play Store
- **iPhone:** Search "Expo Go" on App Store

### Commands:
```bash
cd mobile

# 1. Install dependencies
npm install

# 2. Create .env file
echo "EXPO_PUBLIC_API_URL=http://YOUR-COMPUTER-IP:3000" > .env
echo "EXPO_PUBLIC_WS_URL=http://YOUR-COMPUTER-IP:3000" >> .env
# Replace YOUR-COMPUTER-IP with your PC's local IP
# Find your IP: Windows = ipconfig | Mac/Linux = ifconfig

# 3. Start app
npm start
```

### ✅ A QR code will appear in terminal.
- **Android:** Open Expo Go → Scan QR code
- **iPhone:** Open Camera app → Scan QR code
- **Browser:** Press `w` in terminal

---

## ⚡ STEP 4: Set Up Raspberry Pi (Module 7 - Sensors)

### Hardware needed:
| Item | Price | Where to buy |
|------|-------|--------------|
| Raspberry Pi Zero 2W | ~₱800 | Lazada/Shopee |
| MicroSD Card 16GB | ~₱200 | Any store |
| 6x FC-51 IR Sensors | ~₱600 | Shopee: "FC-51 infrared sensor" |
| Jumper wires female-female | ~₱100 | Shopee |
| Micro USB power cable | ~₱100 | Any store |
| **Total** | **~₱1,800** | |

### Wiring (connect each sensor's OUT to GPIO pin):
```
Pocket Position   →  Raspberry Pi GPIO Pin
TOP_LEFT          →  GPIO 17 (Pin 11)
TOP_RIGHT         →  GPIO 18 (Pin 12)
MIDDLE_LEFT       →  GPIO 22 (Pin 15)
MIDDLE_RIGHT      →  GPIO 23 (Pin 16)
BOTTOM_LEFT       →  GPIO 24 (Pin 18)
BOTTOM_RIGHT      →  GPIO 25 (Pin 22)

All sensor VCC    →  3.3V (Pin 1)
All sensor GND    →  GND (Pin 6)
```

### Setup on Raspberry Pi:
```bash
# Copy sensor folder to Raspberry Pi (using USB or WiFi)
# Then on the Pi:

cd billiard-sensor
chmod +x setup.sh
./setup.sh

# Edit config
cp .env.example .env
nano .env  # Set API_BASE_URL and SENSOR_API_KEY

# Test WITHOUT hardware first (simulation mode)
python3 sensor.py --simulate

# Run with real sensors
python3 sensor.py
```

---

## ⚡ STEP 5: TV Display Setup

1. Connect TV to any device with a browser (laptop, tablet, PC, or Raspberry Pi with browser)
2. Open browser and go to: `http://YOUR-BACKEND-IP:3000` or your deployed URL
3. Navigate to `/tv` route in the web version of the app
4. The TV view shows:
   - Live queue status (minimized, overlay-style)
   - Tournament brackets in real-time
   - Live game scores from sensors

---

## ⚡ STEP 6: Staff Tablet Setup

1. Give staff an Android tablet
2. Install **Expo Go** on the tablet
3. Open the app → Login with staff credentials:
   - Email: `staff@saturdaynights.ph`
   - Password: `Staff@123`
4. Staff sees the **Staff Dashboard** with:
   - Add credits to members
   - POS / take orders
   - Manage inventory
   - View queue

---

## 🔐 Test Credentials (after seeding)

| Role   | Email                          | Password    |
|--------|-------------------------------|-------------|
| Admin  | admin@saturdaynights.ph        | Admin@123   |
| Staff  | staff@saturdaynights.ph        | Staff@123   |
| Member | player@saturdaynights.ph       | Member@123  |

---

## 🚀 Deployment (for production)

### Backend (Railway.app - Free):
1. Go to **https://railway.app** → Sign up with GitHub
2. New Project → Deploy from GitHub repo
3. Add environment variables from your `.env`
4. Railway gives you a public URL automatically

### Database:
- Already hosted on Supabase (free tier)

### Mobile App (Expo EAS - Free):
```bash
npm install -g eas-cli
eas login
eas build --platform android   # Creates APK for Android
```

---

## 📡 API Endpoints Reference

### Auth
- `POST /api/auth/register` - Register new member
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/logout` - Logout
- `GET  /api/auth/me` - Get current user

### Sensor (Module 7)
- `POST /api/sensor/pocket` - Raspberry Pi reports pocket (requires sensor key)
- `POST /api/sensor/game/start` - Start scored game (staff)
- `PATCH /api/sensor/game/:id/score` - Update score manually (staff)
- `PATCH /api/sensor/game/:id/end` - End game (staff)
- `GET  /api/sensor/table/:id/live` - Live data for table

### Tournaments
- `GET  /api/tournaments` - List tournaments
- `POST /api/tournaments` - Create tournament (staff/admin)
- `POST /api/tournaments/:id/register` - Register (member)
- `POST /api/tournaments/:id/brackets` - Generate brackets (staff/admin)
- `PATCH /api/tournaments/matches/:id/result` - Report result

### Credits
- `POST /api/credits/topup` - Staff adds credits to member
- `GET  /api/credits/balance` - Check balance
- `GET  /api/credits/history` - Transaction history

---

## 🎯 Module Priority & Status

| Module | Description | Status |
|--------|-------------|--------|
| ✅ Auth | Login/Register/JWT | **COMPLETE** |
| ✅ Database | Full schema | **COMPLETE** |
| ✅ Sensors | Raspberry Pi code | **COMPLETE** |
| ✅ Tournament | Brackets generation | **COMPLETE** |
| ✅ Credits | Top-up, deduction | **COMPLETE** |
| 🔄 Mobile UI | All screens | IN PROGRESS |
| 🔄 POS | Staff tablet ordering | IN PROGRESS |
| 🔄 Queue | TV display | IN PROGRESS |
| 🔄 Loyalty | Auto rewards | IN PROGRESS |
| 🔄 Analytics | Reports dashboard | IN PROGRESS |
