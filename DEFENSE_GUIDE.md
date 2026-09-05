# 🎱 BILLIARD SYSTEM - BACKEND ARCHITECTURE DEFENSE GUIDE

**Project**: Saturday Nights Billiard Hall Management System  
**Date**: April 21, 2026  
**Backend Stack**: Express.js + PostgreSQL + Prisma ORM + Socket.io  

---

## 📋 TABLE OF CONTENTS

1. [Project Structure Overview](#project-structure-overview)
2. [Root Level Files](#root-level-files)
3. [Database Layer (Prisma)](#database-layer-prisma)
4. [Application Code (SRC)](#application-code-src)
5. [Controllers - Business Logic](#controllers---business-logic)
6. [Middleware - Security](#middleware---security)
7. [Routes](#routes)
8. [Services - Background Jobs](#services---background-jobs)
9. [Utilities](#utilities)
10. [Architecture Decisions](#architecture-decisions)
11. [Business Logic Flows](#business-logic-flows)
12. [Security Measures](#security-measures)
13. [Defense Talking Points](#defense-talking-points)
14. [Deployment Considerations](#deployment-considerations)

---

## PROJECT STRUCTURE OVERVIEW

```
backend/
├── .env                           # Environment variables (secrets)
├── .env.example                   # Template for .env
├── package.json                   # Dependencies & scripts
├── prisma/
│   └── schema.prisma              # Database schema (single source of truth)
├── src/
│   ├── index.js                   # Express server entry point
│   ├── config/
│   │   └── prisma.js              # Database connection singleton
│   ├── controllers/               # Business logic for each feature
│   │   ├── auth.controller.js
│   │   ├── pos.controller.js
│   │   ├── queue.controller.js
│   │   ├── reservation.controller.js
│   │   ├── sensor.controller.js
│   │   ├── table.controller.js
│   │   ├── tournament.controller.js
│   │   └── analytics.controller.js
│   ├── middleware/
│   │   └── auth.middleware.js     # JWT verification & role-based access control
│   ├── routes/                    # API endpoint definitions
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── membership.routes.js
│   │   ├── table.routes.js
│   │   ├── queue.routes.js
│   │   ├── session.routes.js
│   │   ├── tournament.routes.js
│   │   ├── pos.routes.js
│   │   ├── reservation.routes.js
│   │   ├── payment.routes.js
│   │   ├── analytics.routes.js
│   │   └── [other routes].js
│   ├── services/                  # Background jobs & scheduled tasks
│   │   ├── sessionMonitor.js      # Auto-billing (runs every 5s)
│   │   └── reservationScheduler.js # Auto-start reservations (runs every 30s)
│   └── utils/                     # Helper functions & utilities
│       ├── jwt.js                 # Token generation & verification
│       ├── creditLifecycle.js     # Credit expiry & rewards logic
│       ├── mailer.js              # Email delivery
│       ├── reservationMeta.js     # Payment metadata parsing
│       └── seed.js                # Database initialization
```

---

## ROOT LEVEL FILES

### **package.json** - Project Dependencies & Scripts

**Purpose**: Declares all npm packages and custom scripts.

**Key Dependencies**:
```json
{
  "name": "billiard-backend",
  "version": "1.0.0",
  "description": "Saturday Nights Billiard Hall Management System - Backend API",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",           // Production start
    "dev": "nodemon src/index.js",          // Development with hot-reload
    "db:push": "npx prisma db push",        // Sync schema with database
    "db:studio": "npx prisma studio",       // GUI database editor
    "db:generate": "npx prisma generate",   // Generate Prisma client
    "db:seed": "node src/utils/seed.js"     // Initialize sample data
  },
  "dependencies": {
    "@prisma/client": "^5.10.0",            // Database client
    "bcryptjs": "^2.4.3",                   // Password hashing
    "cors": "^2.8.5",                       // Cross-origin requests
    "dotenv": "^16.4.1",                    // Environment variables
    "express": "^4.18.2",                   // REST API framework
    "express-rate-limit": "^7.2.0",         // Rate limiting (prevent abuse)
    "express-validator": "^7.3.2",          // Input validation
    "helmet": "^7.1.0",                     // HTTP security headers
    "jsonwebtoken": "^9.0.3",               // JWT authentication
    "morgan": "^1.10.0",                    // HTTP request logging
    "multer": "^1.4.5-lts.1",               // File upload handling
    "nodemailer": "^8.0.5",                 // Email sending
    "socket.io": "^4.7.4",                  // Real-time WebSocket communication
    "uuid": "^9.0.1"                        // Unique ID generation
  },
  "devDependencies": {
    "nodemon": "^3.1.0",                    // Auto-restart on file changes
    "prisma": "^5.10.0"                     // Database tools & CLI
  }
}
```

**Why These Technologies?**
- **Express.js**: Lightweight, minimal overhead, industry standard for Node.js APIs
- **Prisma**: Type-safe database queries, prevents SQL injection, auto-migrations
- **Socket.io**: Real-time push notifications (TV display, queue updates)
- **JWT**: Stateless authentication (scalable, mobile-friendly)
- **bcryptjs**: Secure password hashing with automatic salt
- **Helmet**: Security headers (prevents XSS, clickjacking, MIME sniffing)

---

### **.env & .env.example** - Configuration & Secrets

**Purpose**: Stores sensitive credentials and environment-specific configuration.

**Contains**:
```
# Database
DATABASE_URL=postgresql://...@supabase...

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# API URLs
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Email Service
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_HOST=smtp.gmail.com

# Node Environment
NODE_ENV=development
PORT=3000
```

**Why Separate File?**
- Keeps secrets out of version control (add `.env` to `.gitignore`)
- Different configs for dev/staging/production
- Team members can have different credentials locally
- CI/CD pipelines inject secrets at deployment

---

## DATABASE LAYER (PRISMA)

### **prisma/schema.prisma** - Database Schema Definition

**Purpose**: Single source of truth for database structure. Defines all models, relationships, and constraints.

**Key Concepts**:
- **Models**: Each model maps to a database table
- **Relations**: Define foreign keys and relationship types
- **Enums**: Restrict values to specific options
- **@map**: Custom database field names

#### **MODULE 1: AUTH & USERS**

```prisma
enum UserRole {
  ADMIN      // Can manage staff, settings, analytics
  STAFF      // Can operate POS, manage queue, check sensors
  MEMBER     // Can book, join tournaments, use gamification
  WALKIN     // No account, pay-per-session
}

model User {
  id                String           @id @default(uuid())
  email             String           @unique              // Unique login identifier
  phone             String           @unique              // For SMS notifications
  password          String                                // Hashed with bcryptjs
  role              UserRole         @default(MEMBER)    // Role-based access control
  firstName         String
  lastName          String
  dateOfBirth       DateTime?
  avatarUrl         String?
  pushToken         String?                              // Expo push notification token
  isEmailVerified   Boolean          @default(false)     // Email verification status
  emailVerifyToken  String?                              // 24-hour expiry token
  emailVerifyExpires DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  // Relations
  membership        Membership?
  gamifiedProfile   GamifiedProfile?
  transactions      CreditTransaction[]                  // Audit trail of all credits
  reservations      Reservation[]
  tournamentEntries TournamentEntry[]
  notifications     Notification[]
  orders            Order[]
  sessions          TableSession[]
  loyaltyHistory    LoyaltyHistory[]
  staffActions      StaffAction[]    @relation("StaffUser")
  refreshTokens     RefreshToken[]

  @@map("users")
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique                             // JWT refresh token
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime                                     // Auto-cleanup old tokens
  createdAt DateTime @default(now())

  @@map("refresh_tokens")
}
```

**Why This Design?**
- **Separate refresh tokens**: Tokens are revocable if compromised
- **Email verification**: Prevents signup abuse, confirms user owns email
- **Push notifications**: Direct app notifications without user polling
- **Role-based access**: Fine-grained permission control

---

#### **MODULE 2: MEMBERSHIP & GAMIFICATION**

```prisma
enum MembershipPlan {
  BASIC       // Standard - can join tournaments
  PREMIUM     // Faster loyalty accrual, priority queue
  VIP         // VIP room access, exclusive tournaments
}

enum MembershipStatus {
  ACTIVE
  INACTIVE
  SUSPENDED   // Banned for violations
}

model Membership {
  id               String           @id @default(uuid())
  userId           String           @unique
  user             User             @relation(fields: [userId], references: [id])
  plan             MembershipPlan   @default(BASIC)
  status           MembershipStatus @default(ACTIVE)
  creditBalance    Float            @default(0)   // 1 credit = 1 PHP = 1 minute playtime
  totalHoursPlayed Float            @default(0)   // Lifetime stat
  joinedAt         DateTime         @default(now())
  expiresAt        DateTime?        // Premium/VIP plan expiry
  updatedAt        DateTime         @updatedAt

  @@map("memberships")
}

model GamifiedProfile {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id])
  displayName      String   // Gamertag for leaderboards
  level            Int      @default(1)
  xp               Int      @default(0)
  totalWins        Int      @default(0)
  totalLosses      Int      @default(0)
  totalGames       Int      @default(0)
  winStreak        Int      @default(0)
  bestStreak       Int      @default(0)
  totalBallsPotted Int      @default(0)
  // Rank progression: Rookie → Hustler → Shark → Legend → Elite
  rank             String   @default("Rookie")
  badges           String[] @default([])           // Achievement system
  updatedAt        DateTime @updatedAt

  @@map("gamified_profiles")
}
```

**Why Gamification?**
- **Engagement**: Ranks, badges, XP encourage repeat visits
- **Retention**: Members compete for leaderboard positions
- **Revenue**: Players spend more credits chasing higher ranks
- **Community**: Creates social experience around billiards

---

#### **MODULE 3: TABLE MANAGEMENT & QUEUE**

```prisma
enum TableType {
  STANDARD    // Regular 8-ball tables
  VIP         // Premium location, higher rate
}

enum TableStatus {
  AVAILABLE   // Ready for next player
  OCCUPIED    // Someone is playing
  RESERVED    // Booked for later
  MAINTENANCE // Out of service
}

model BilliardTable {
  id            String          @id @default(uuid())
  tableNumber   Int             @unique              // Display ID (1-20)
  type          TableType       @default(STANDARD)
  status        TableStatus     @default(AVAILABLE)
  ratePerHour   Float           @default(60)        // PHP per hour
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  sessions      TableSession[]                       // Historical play sessions
  reservations  Reservation[]
  queue         QueueEntry[]
  sensorData    SensorReading[]

  @@map("billiard_tables")
}

enum QueueStatus {
  WAITING     // In queue
  CALLED      // Next to play
  PLAYING     // Assigned to table
  NOSHOW      // Didn't show up
  CANCELLED   // Left voluntarily
}

model QueueEntry {
  id              String          @id @default(uuid())
  userId          String
  user            User            @relation(fields: [userId], references: [id])
  tableId          String
  table            BilliardTable   @relation(fields: [tableId], references: [id])
  status          QueueStatus     @default(WAITING)
  position        Int                              // Current queue position
  joinedAt        DateTime        @default(now())
  assignedAt      DateTime?
  endedAt         DateTime?
  priority        Int             @default(0)      // PREMIUM members get +1

  @@map("queue_entries")
}

model TableSession {
  id              String          @id @default(uuid())
  tableId         String
  table           BilliardTable   @relation(fields: [tableId], references: [id])
  userId          String?                          // Null if WALKIN (cash payment)
  user            User?           @relation(fields: [userId], references: [id])
  isWalkin        Boolean         @default(false)
  startTime       DateTime        @default(now())
  endTime         DateTime?
  status          String          @default("ACTIVE") // ACTIVE, ENDED, PAUSED
  creditsUsed     Float           @default(0)        // Cost in credits
  rateApplied     Float                              // Locked rate at session start
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@map("table_sessions")
}
```

**Why This Design?**
- **Real-time status tracking**: TV display shows available/occupied tables instantly
- **Queue priority**: PREMIUM members don't wait as long
- **Session audit trail**: Track who played, when, and cost
- **Walkin support**: Cash-paying guests without accounts
- **Rate locking**: Prevents price changes mid-session

---

#### **MODULE 4: RESERVATIONS & TOURNAMENTS**

```prisma
enum ReservationStatus {
  PENDING     // Awaiting admin approval
  APPROVED    // Confirmed, will become active at startTime
  REJECTED    // Admin declined
  CANCELLED   // User cancelled
  COMPLETED   // Session finished
}

model Reservation {
  id              String            @id @default(uuid())
  userId          String
  user            User              @relation(fields: [userId], references: [id])
  tableId         String
  table           BilliardTable     @relation(fields: [tableId], references: [id])
  startTime       DateTime          // When they want to play
  endTime         DateTime          // Duration in hours
  status          ReservationStatus @default(PENDING)
  notes           String?           // Payment method metadata
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@map("reservations")
}

enum TournamentStatus {
  DRAFT       // Being created
  OPEN        // Accepting registrations
  STARTED     // Matches in progress
  COMPLETED   // All matches done, winners crowned
}

enum TournamentFormat {
  SINGLE_ELIM  // Lose once, out
  DOUBLE_ELIM  // Lose twice, out
  ROUND_ROBIN  // Everyone plays everyone
}

model Tournament {
  id              String             @id @default(uuid())
  name            String
  description     String?
  format          TournamentFormat   @default(SINGLE_ELIM)
  status          TournamentStatus   @default(DRAFT)
  startDate       DateTime
  endDate         DateTime
  maxPlayers      Int
  prizePool       Float              // Total winnings
  entryFee        Float
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  entries         TournamentEntry[]
  matches         Match[]

  @@map("tournaments")
}

model TournamentEntry {
  id              String        @id @default(uuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  tournamentId    String
  tournament      Tournament    @relation(fields: [tournamentId], references: [id])
  seedRank        Int?          // Starting position in bracket
  isActive        Boolean       @default(true)
  joinedAt        DateTime      @default(now())

  @@map("tournament_entries")
}

model Match {
  id              String          @id @default(uuid())
  tournamentId    String
  tournament      Tournament      @relation(fields: [tournamentId], references: [id])
  player1Id       String
  player2Id       String
  winnerId        String?         // Null until match completes
  round           Int             // Which round of tournament
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@map("matches")
}
```

**Why This Design?**
- **Approval workflow**: Admin controls tournament quality
- **Format flexibility**: Support different bracket types
- **Prize distribution**: Fair payout mechanism
- **Match tracking**: Compute XP rewards, rank changes from results

---

#### **MODULE 5: LOYALTY & REWARDS**

```prisma
model CreditTransaction {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  type            String    // DEDUCTION, TOPUP, BONUS, REWARD, REFUND
  amount          Float
  balanceBefore   Float
  balanceAfter    Float
  description     String    // Human-readable reason
  createdAt       DateTime  @default(now())

  @@map("credit_transactions")
}

model LoyaltyHistory {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  rewardType      String    // SPEND_BONUS (10%), BIRTHDAY_BONUS, MILESTONE
  creditsAwarded  Float
  reason          String
  createdAt       DateTime  @default(now())

  @@map("loyalty_history")
}
```

**Why This Design?**
- **Spend rewards**: 10% rebate on food orders = repeat customers
- **Birthday bonuses**: Personalized engagement
- **Transparent audit trail**: Members see every credit movement
- **Analytics**: Track which rewards drive behavior

---

#### **MODULE 6: POS & PAYMENTS**

```prisma
model Product {
  id              String    @id @default(uuid())
  name            String
  category        String    // Food, Beverage, Merch
  price           Float
  stock           Int       @default(0)
  lowStockAt      Int       @default(5)    // Alert when below threshold
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  orderItems      OrderItem[]
  stockHistory    StockHistory[]

  @@map("products")
}

model Order {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  total           Float
  status          String    @default("PENDING")  // PENDING, PAID, CANCELLED
  paymentMethod   String    // CASH, CREDIT_CARD, E_WALLET
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  items           OrderItem[]
  payment         Payment?

  @@map("orders")
}

model OrderItem {
  id              String    @id @default(uuid())
  orderId         String
  order           Order     @relation(fields: [orderId], references: [id])
  productId       String
  product         Product   @relation(fields: [productId], references: [id])
  quantity        Int
  priceAtPurchase Float     // Lock price at time of order
  subtotal        Float

  @@map("order_items")
}

model Payment {
  id              String    @id @default(uuid())
  orderId         String    @unique
  order           Order     @relation(fields: [orderId], references: [id])
  amount          Float
  method          String    // CASH, CREDIT_CARD, E_WALLET
  status          String    @default("PENDING")
  transactionId   String?   // Payment gateway reference
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@map("payments")
}

model StockHistory {
  id              String    @id @default(uuid())
  productId       String
  product         Product   @relation(fields: [productId], references: [id])
  change          Int       // +50 for restock, -5 for sale
  reason          String    // SALE, RESTOCK, ADJUSTMENT, DAMAGE
  staffId         String    // Who made the change
  createdAt       DateTime  @default(now())

  @@map("stock_history")
}
```

**Why This Design?**
- **Complete POS system**: Ancillary revenue (food/beverage)
- **Stock tracking**: Prevent running out of popular items
- **Audit trail**: Know why inventory changed and by whom
- **Payment flexibility**: Cash + digital payment methods

---

#### **MODULE 7: NOTIFICATIONS & ANALYTICS**

```prisma
enum NotificationType {
  QUEUE_READY         // Your table is ready
  RESERVATION_APPROVED
  CREDIT_EXPIRING     // 3 days before expiry
  TOURNAMENT_UPDATE   // Match results
  ORDER_READY         // Food is ready
  MEMBERSHIP_EXPIRING
}

model Notification {
  id              String              @id @default(uuid())
  userId          String
  user            User                @relation(fields: [userId], references: [id])
  type            NotificationType
  title           String
  body            String
  data            String?             // JSON metadata
  read            Boolean             @default(false)
  sentAt          DateTime            @default(now())
  readAt          DateTime?

  @@map("notifications")
}

model SensorReading {
  id              String    @id @default(uuid())
  tableId         String
  table           BilliardTable @relation(fields: [tableId], references: [id])
  ballsInPocket   Int       // Detected balls potted
  tableOccupied   Boolean   // Motion detected
  readingTime     DateTime  @default(now())

  @@map("sensor_readings")
}
```

**Why This Design?**
- **Push notifications**: Real-time alerts (table ready, credits expiring)
- **Sensor integration**: IoT motion detection + ball potting analysis
- **Engagement**: Timely reminders increase app usage

---

### **Why Prisma?**

1. **Type Safety**: JavaScript errors caught at compile time (similar to TypeScript)
2. **Auto-migrations**: `npx prisma db push` syncs schema with DB
3. **Prevents SQL Injection**: Parameterized queries by default
4. **Prisma Studio**: Visual database editor accessible at `npx prisma studio`
5. **Relations**: Automatic JOIN queries, no manual foreign key management
6. **Transactions**: Atomic operations with `prisma.$transaction()`

**Example**:
```javascript
// Type-safe query with auto-completion
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { membership: true, orders: true }
});
```

---

## APPLICATION CODE (SRC)

### **src/index.js** - Express Server Entry Point

**Purpose**: Initializes Express app, configures middleware, mounts routes, sets up Socket.io for real-time features.

**Key Components**:

#### 1. **Middleware Stack**
```javascript
const app = express();
const server = http.createServer(app);

// Security
app.use(helmet());           // HTTP security headers
app.use(cors(...));          // Allow cross-origin requests

// Logging
app.use(morgan('dev'));      // Log every HTTP request

// Request Parsing
app.use(express.json({ limit: '10mb' }));       // Parse JSON body
app.use(express.urlencoded({ extended: true })); // Parse form data

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 200,                  // 200 requests per window
});
app.use('/api', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                   // Stricter limit for login attempts
});
```

**Why?**
- **helmet()**: Prevents common web vulnerabilities (XSS, clickjacking)
- **Rate limiting**: Prevents brute-force attacks and DDoS
- **morgan**: Debugging HTTP issues in development

#### 2. **Socket.IO Configuration**
```javascript
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);  // Make io accessible in routes

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Join rooms for targeted broadcasts
  socket.on('join:table', (tableId) => socket.join(`table:${tableId}`));
  socket.on('join:tournament', (tournamentId) => socket.join(`tournament:${tournamentId}`));
  socket.on('join:tv', () => socket.join('tv-display'));
  socket.on('join:staff', () => socket.join('staff-tablet'));

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});
```

**Real-time Use Cases**:
- **TV Display**: Broadcasts available/occupied tables
- **Staff Tablet**: New orders, queue updates, table assignments
- **Tournament Bracket**: Live match results
- **Member App**: Queue position, reservation status

#### 3. **Route Mounting**
```javascript
app.use('/api/auth', authLimiter, require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/membership', require('./routes/membership.routes'));
app.use('/api/tables', require('./routes/table.routes'));
app.use('/api/queue', require('./routes/queue.routes'));
app.use('/api/sessions', require('./routes/session.routes'));
app.use('/api/tournaments', require('./routes/tournament.routes'));
app.use('/api/orders', require('./routes/order.routes'));
app.use('/api/reservations', require('./routes/reservation.routes'));
// ... more routes
```

#### 4. **Error Handling**
```javascript
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});
```

---

### **src/config/prisma.js** - Database Connection

**Purpose**: Exports singleton Prisma client instance to prevent multiple connections.

```javascript
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
```

**Why Singleton?**
- Only one database connection pool (no resource waste)
- Consistent client instance across entire app
- Easy to debug with Prisma Studio

---

## CONTROLLERS - BUSINESS LOGIC

Controllers contain the actual feature implementations. Each controller has functions that handle specific API endpoints.

### **auth.controller.js** - Authentication

**Key Functions**:

#### 1. **Register Endpoint**
```javascript
const register = async (req, res) => {
  const { email, phone, password, firstName, lastName, role } = req.body;

  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    // Check if user exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existingUser) return res.status(409).json({ error: 'Email or phone already exists' });

    // Hash password with bcryptjs (10 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate email verification token
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        role,
        emailVerifyToken,
        emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
      },
    });

    // Create associated membership if MEMBER
    if (role === 'MEMBER') {
      await prisma.membership.create({
        data: { userId: user.id },
      });
      await prisma.gamifiedProfile.create({
        data: { userId: user.id, displayName: firstName },
      });
    }

    // Send verification email
    await sendVerificationEmail(email, emailVerifyToken);

    res.status(201).json({ message: 'User created. Check your email to verify.' });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
};
```

**Security Features**:
- **bcryptjs**: Hashes password with automatic salt (takes ~200ms, prevents rainbow table attacks)
- **Email verification**: Confirms user owns email, prevents signup abuse
- **Token expiry**: 24-hour window to verify, then new registration needed
- **Unique constraints**: DB prevents duplicate emails/phones

#### 2. **Login Endpoint**
```javascript
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Compare password (bcryptjs auto-detects salt)
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) return res.status(401).json({ error: 'Invalid credentials' });

    // Check if email verified
    if (!user.isEmailVerified) {
      return res.status(403).json({ error: 'Please verify your email first' });
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token in DB
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
};
```

#### 3. **Email Verification Endpoint**
```javascript
const verifyEmail = async (req, res) => {
  const { token } = req.query;

  try {
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpires: { gt: new Date() }, // Token not expired
      },
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed' });
  }
};
```

**Why JWT + Refresh Tokens?**
- **Stateless**: No session storage on server
- **Scalable**: Works across multiple server instances
- **Mobile-friendly**: Fits in HTTP Authorization header
- **Revocable**: Refresh tokens can be deleted if compromised
- **Token rotation**: Short access token (15min) + long refresh token (7 days)

---

### **pos.controller.js** - Point of Sale

**Key Functions**:

#### 1. **Create Order**
```javascript
const createOrder = async (req, res) => {
  const { items } = req.body; // [{ productId, quantity }, ...]
  const userId = req.user.id;

  try {
    // Validate stock availability
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }
    }

    // Calculate total within transaction
    const order = await prisma.$transaction(async (tx) => {
      let total = 0;
      const orderItems = [];

      // Create order items and deduct stock
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        const subtotal = product.price * item.quantity;
        total += subtotal;

        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          priceAtPurchase: product.price,
          subtotal,
        });

        // Deduct stock
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Create order
      const order = await tx.order.create({
        data: {
          userId,
          total,
          items: { createMany: { data: orderItems } },
        },
        include: { items: true },
      });

      return order;
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: 'Order creation failed' });
  }
};
```

#### 2. **Process Payment**
```javascript
const processPayment = async (req, res) => {
  const { orderId, method } = req.body;
  const userId = req.user.id;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: { include: { membership: true } } },
    });

    if (!order || order.userId !== userId) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Process payment (integrate with payment gateway)
    const result = await prisma.$transaction(async (tx) => {
      // Create payment record
      const payment = await tx.payment.create({
        data: { orderId, amount: order.total, method, status: 'COMPLETED' },
      });

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
      });

      // Award loyalty reward (10% bonus)
      const reward = order.total * 0.1;
      await tx.membership.update({
        where: { userId },
        data: { creditBalance: { increment: reward } },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'REWARD',
          amount: reward,
          description: `10% loyalty bonus for order ${orderId}`,
          balanceBefore: order.user.membership.creditBalance,
          balanceAfter: order.user.membership.creditBalance + reward,
        },
      });

      return payment;
    });

    res.json({ message: 'Payment successful', reward: order.total * 0.1 });
  } catch (err) {
    res.status(500).json({ error: 'Payment processing failed' });
  }
};
```

**Why Loyalty Rewards?**
- **10% rebate**: Encourages food/beverage purchases
- **Repeat spending**: Members return more often
- **Analytics**: Track which promotions work

---

### **queue.controller.js** - Queue Management

**Key Functions**:

#### 1. **Join Queue**
```javascript
const joinQueue = async (req, res) => {
  const { tableId } = req.body;
  const userId = req.user.id;

  try {
    // Check if already in queue
    const existingEntry = await prisma.queueEntry.findFirst({
      where: { userId, status: 'WAITING' },
    });
    if (existingEntry) return res.status(400).json({ error: 'Already in queue' });

    // Get queue count (for position)
    const queueCount = await prisma.queueEntry.count({
      where: { tableId, status: 'WAITING' },
    });

    // Determine priority (PREMIUM members get +1)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { membership: true },
    });
    const priority = user.membership?.plan === 'PREMIUM' ? 1 : 0;

    const entry = await prisma.queueEntry.create({
      data: {
        userId,
        tableId,
        position: queueCount + 1,
        priority,
      },
    });

    // Broadcast queue update
    const io = req.app.get('io');
    io.to(`table:${tableId}`).emit('queue:updated', {
      tableId,
      newPosition: entry.position,
    });
    io.to('tv-display').emit('queue:updated');

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to join queue' });
  }
};
```

#### 2. **Get Queue Position**
```javascript
const getQueuePosition = async (req, res) => {
  const { tableId } = req.params;
  const userId = req.user.id;

  try {
    const entry = await prisma.queueEntry.findFirst({
      where: { userId, tableId, status: { in: ['WAITING', 'CALLED'] } },
    });

    if (!entry) return res.status(404).json({ error: 'Not in queue' });

    // Count how many are ahead
    const ahead = await prisma.queueEntry.count({
      where: {
        tableId,
        status: 'WAITING',
        position: { lt: entry.position },
      },
    });

    res.json({ position: entry.position, estimatedWait: ahead * 30 }); // 30min per game
  } catch (err) {
    res.status(500).json({ error: 'Failed to get position' });
  }
};
```

**Why Real-time Queue?**
- **Fairness**: First-come-first-served with priority tiers
- **Engagement**: Members know wait time (reduces abandonment)
- **TV display**: Shows queue length to attract walk-ins

---

### **tournament.controller.js** - Tournaments

**Key Functions**:

#### 1. **Create Tournament**
```javascript
const createTournament = async (req, res) => {
  const { name, format, startDate, maxPlayers, entryFee, prizePool } = req.body;

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only admins can create tournaments' });
  }

  try {
    const tournament = await prisma.tournament.create({
      data: {
        name,
        format,
        startDate: new Date(startDate),
        endDate: new Date(new Date(startDate).getTime() + 8 * 60 * 60 * 1000), // 8h duration
        maxPlayers,
        entryFee,
        prizePool,
      },
    });

    res.status(201).json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Tournament creation failed' });
  }
};
```

#### 2. **Register for Tournament**
```javascript
const registerPlayer = async (req, res) => {
  const { tournamentId } = req.params;
  const userId = req.user.id;

  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { entries: true },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'OPEN') return res.status(400).json({ error: 'Tournament not open' });
    if (tournament.entries.length >= tournament.maxPlayers) {
      return res.status(400).json({ error: 'Tournament full' });
    }

    // Deduct entry fee from credits
    const membership = await prisma.membership.findUnique({ where: { userId } });
    if (membership.creditBalance < tournament.entryFee) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    const entry = await prisma.$transaction(async (tx) => {
      // Create tournament entry
      const entry = await tx.tournamentEntry.create({
        data: { userId, tournamentId },
      });

      // Deduct fee
      await tx.membership.update({
        where: { userId },
        data: { creditBalance: { decrement: tournament.entryFee } },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'DEDUCTION',
          amount: tournament.entryFee,
          description: `Entry fee for tournament: ${tournament.name}`,
        },
      });

      return entry;
    });

    // Broadcast tournament update
    const io = req.app.get('io');
    io.to(`tournament:${tournamentId}`).emit('tournament:updated', {
      tournament,
      newPlayer: entry,
    });

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
};
```

#### 3. **Update Match Result**
```javascript
const updateMatchResult = async (req, res) => {
  const { matchId } = req.params;
  const { winnerId } = req.body;

  if (req.user.role !== 'STAFF' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only staff can update matches' });
  }

  try {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });

    if (!match) return res.status(404).json({ error: 'Match not found' });

    const winner = await prisma.user.findUnique({
      where: { id: winnerId },
      include: { gamifiedProfile: true },
    });

    const updated = await prisma.$transaction(async (tx) => {
      // Update match
      const match = await tx.match.update({
        where: { id: matchId },
        data: { winnerId },
      });

      // Award XP to winner (50 XP per match win)
      const xpReward = 50;
      await tx.gamifiedProfile.update({
        where: { userId: winnerId },
        data: {
          xp: { increment: xpReward },
          totalWins: { increment: 1 },
          totalGames: { increment: 1 },
          winStreak: { increment: 1 },
        },
      });

      // Update loser
      const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id;
      await tx.gamifiedProfile.update({
        where: { userId: loserId },
        data: {
          totalLosses: { increment: 1 },
          totalGames: { increment: 1 },
          winStreak: 0, // Reset streak
        },
      });

      return match;
    });

    // Broadcast bracket update
    const io = req.app.get('io');
    io.to(`tournament:${match.tournamentId}`).emit('match:completed', {
      matchId,
      winnerId,
      xpAwarded: 50,
    });

    res.json({ message: 'Match result recorded', xpReward: 50 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update match' });
  }
};
```

**Why Gamification?**
- **XP/Levels**: Players feel progression
- **Win streaks**: Creates competition
- **Leaderboards**: Social engagement (bragging rights)
- **Rank progression**: Rookie → Hustler → Shark → Legend → Elite

---

## MIDDLEWARE - SECURITY

### **auth.middleware.js** - Authentication & Authorization

**Purpose**: Protect routes, verify JWT, check user permissions, and run credit lifecycle logic.

#### 1. **Authentication Middleware**
```javascript
const authenticate = async (req, res, next) => {
  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT signature & expiry
    const decoded = verifyAccessToken(token);

    // Fetch user from DB (catches deleted users, banned accounts)
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        membership: {
          select: {
            status: true,
            creditBalance: true,
            plan: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!user) return res.status(401).json({ error: 'User not found' });

    // Run credit lifecycle checks (expire old credits, send notifications)
    if (user.membership && user.role === 'MEMBER') {
      const membership = await expireCreditsIfNeeded(user.id, prisma);
      await notifyExpiringCredits(user.id, prisma);
      req.user = {
        ...user,
        membership: membership ? { ...user.membership, ...membership } : user.membership,
      };
    } else {
      req.user = user;
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
```

**Why This Design?**
- **Stateless**: No session storage (scalable)
- **Per-request verification**: Catches deleted users or role changes
- **Automatic credit lifecycle**: No separate job needed
- **TokenExpiredError handling**: Client can use refresh token to get new access token

#### 2. **Authorization Middleware**
```javascript
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access denied: Insufficient permissions',
        requiredRole: roles,
        userRole: req.user.role,
      });
    }
    next();
  };
};
```

**Usage**:
```javascript
router.post('/create-tournament',
  authenticate,                          // Must be logged in
  authorize('ADMIN'),                    // Must be admin
  controller.createTournament
);

router.post('/join-queue',
  authenticate,
  authorize('MEMBER', 'ADMIN'),          // Member or admin
  controller.joinQueue
);
```

**Role-Based Access Control (RBAC)**:
- **ADMIN**: Full access (settings, staff management, analytics)
- **STAFF**: Operate POS, manage queue, check sensors
- **MEMBER**: Book tables, join tournaments, use gamification
- **WALKIN**: Pay per session, no account features

---

## ROUTES

Routes define API endpoints by mounting them in `index.js`. Each route file exports an Express router with specific endpoints.

**Pattern**:
```javascript
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const controller = require('../controllers/...');

// Public endpoints
router.post('/register', validate([...]), controller.register);
router.post('/login', validate([...]), controller.login);

// Protected endpoints (requires authentication)
router.get('/profile', authenticate, controller.getProfile);

// Admin-only endpoints
router.post('/admin/create-tournament',
  authenticate,
  authorize('ADMIN'),
  controller.createTournament
);

module.exports = router;
```

**All Route Files**:
| File | Endpoints | Purpose |
|------|-----------|---------|
| auth.routes.js | POST /register, /login, /verify-email, /refresh-token | User authentication |
| user.routes.js | GET /profile, PUT /profile | User profile management |
| membership.routes.js | GET /plan, POST /upgrade, POST /topup-credits | Membership & credit topup |
| table.routes.js | GET /list, GET /:id | View table status |
| queue.routes.js | POST /join, GET /position, DELETE /leave | Queue management |
| session.routes.js | POST /start, GET /active, POST /end | Table session tracking |
| tournament.routes.js | POST /create, GET /:id, POST /:id/register, POST /match-result | Tournament management |
| pos.routes.js | GET /products, POST /order, POST /payment | Point of sale |
| reservation.routes.js | POST /book, GET /list, POST /:id/cancel | Table reservations |
| payment.routes.js | POST /process, GET /history | Payment tracking |
| order.routes.js | GET /:id, GET /list | Order history |
| analytics.routes.js | GET /revenue, GET /members, GET /peak-hours | Business analytics |
| sensor.routes.js | POST /reading, GET /table/:id | IoT sensor data |
| notification.routes.js | GET /list, POST /:id/read | User notifications |
| staff.routes.js | GET /actions, POST /action-log | Staff action tracking |
| loyalty.routes.js | GET /history, GET /balance | Loyalty program |
| product.routes.js | GET /list, POST /create, PUT /:id | Inventory management |
| credit.routes.js | GET /balance, POST /topup | Credit management |
| session.routes.js | POST /start, GET /active, POST /end | Session tracking |

---

## SERVICES - BACKGROUND JOBS

Services run periodically to automate business logic without user action.

### **sessionMonitor.js** - Auto-Billing (Every ~5 seconds)

**Purpose**: Automatically deduct credits as players use tables.

```javascript
const syncActiveSessions = async (io) => {
  // Find all active sessions (players currently playing)
  const sessions = await prisma.tableSession.findMany({
    where: { status: 'ACTIVE', userId: { not: null } },
    include: { table: true },
  });

  for (const session of sessions) {
    const membership = await prisma.membership.findUnique({
      where: { userId: session.userId },
    });
    if (!membership) continue;

    // Calculate how much should be charged
    // Formula: (elapsed_hours * rate_per_hour)
    const elapsedMinutes = Math.max(
      0,
      (Date.now() - new Date(session.startTime).getTime()) / 60000
    );
    const shouldBeUsed = Number(
      ((elapsedMinutes / 60) * session.table.ratePerHour).toFixed(2)
    );
    const alreadyUsed = Number(session.creditsUsed || 0);
    const additionalNeeded = Number((shouldBeUsed - alreadyUsed).toFixed(2));

    if (additionalNeeded <= 0) continue;

    const available = Number(membership.creditBalance || 0);
    const deduction = Math.min(additionalNeeded, available);

    // Atomic transaction: update all 3 at once
    await prisma.$transaction(async (tx) => {
      if (deduction > 0) {
        // Deduct from member
        await tx.membership.update({
          where: { userId: session.userId },
          data: { creditBalance: { decrement: deduction } },
        });

        // Update session cost
        await tx.tableSession.update({
          where: { id: session.id },
          data: { creditsUsed: { increment: deduction } },
        });

        // Create audit trail
        await tx.creditTransaction.create({
          data: {
            userId: session.userId,
            type: 'DEDUCTION',
            amount: deduction,
            balanceBefore: membership.creditBalance,
            balanceAfter: membership.creditBalance - deduction,
            description: `Auto-deduction for Table ${session.table.tableNumber} usage`,
          },
        });
      }

      // If credits ran out, end session
      if (available <= additionalNeeded) {
        await tx.tableSession.update({
          where: { id: session.id },
          data: {
            status: 'ENDED',
            endTime: new Date(),
          },
        });

        await tx.billiardTable.update({
          where: { id: session.tableId },
          data: { status: 'AVAILABLE' },
        });

        // Notify via Socket.io
        io?.to('staff-tablet').emit('table:available', {
          tableId: session.tableId,
          reason: 'Credits exhausted',
        });
        io?.to('tv-display').emit('table:available', { tableId: session.tableId });
      }
    });
  }
};
```

**Why This Architecture?**
- **Automation**: No manual billing or staff intervention
- **Atomic transactions**: All-or-nothing (prevents partial updates)
- **Real-time**: Members see credits deducted live
- **Accuracy**: Prevents overbilling or underbilling
- **Fairness**: All members charged equally per rate card

**How It's Called** (in index.js):
```javascript
setInterval(() => {
  syncActiveSessions(io).catch(console.error);
}, 5000); // Every 5 seconds
```

---

### **reservationScheduler.js** - Auto-Start Reservations (Every ~30 seconds)

**Purpose**: When reservation's `startTime` arrives, automatically create table session and mark table as occupied.

```javascript
const syncScheduledReservations = async (io) => {
  const now = new Date();

  // Find reservations whose startTime has arrived
  const reservationsToStart = await prisma.reservation.findMany({
    where: {
      status: 'APPROVED',
      startTime: { lte: now },
      endTime: { gt: now },
    },
    include: { table: true, user: true },
  });

  for (const reservation of reservationsToStart) {
    // Check if session already exists
    const activeSession = await prisma.tableSession.findFirst({
      where: {
        tableId: reservation.tableId,
        status: 'ACTIVE',
        startTime: { lte: reservation.endTime },
      },
    });

    if (!activeSession) {
      const paymentMethod = parseReservationPaymentMethod(reservation.notes);

      // Create session
      const session = await prisma.$transaction(async (tx) => {
        const createdSession = await tx.tableSession.create({
          data: {
            tableId: reservation.tableId,
            userId: paymentMethod === 'CASH' ? null : reservation.userId, // Null for cash
            isWalkin: false,
            startTime: reservation.startTime,
            status: 'ACTIVE',
          },
        });

        // Mark table as occupied
        await tx.billiardTable.update({
          where: { id: reservation.tableId },
          data: { status: 'OCCUPIED' },
        });

        return createdSession;
      });

      // Notify staff & TV display
      io?.to('staff-tablet').emit('table:updated', {
        tableId: reservation.tableId,
        status: 'OCCUPIED',
        session,
      });
      io?.to('tv-display').emit('table:updated', {
        tableId: reservation.tableId,
        status: 'OCCUPIED',
      });
    }
  }
};
```

**Why This Architecture?**
- **Zero staff effort**: Reservations auto-activate at scheduled time
- **Reliability**: Transactional guarantees (no double-booking)
- **Transparency**: Staff instantly knows table assignments
- **Cash support**: Handles both credit/cash payments

---

## UTILITIES

### **jwt.js** - Token Management

**Purpose**: Generate and verify JWT tokens (Access + Refresh).

```javascript
const jwt = require('jsonwebtoken');

// Generate both access and refresh tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '15m' } // Short-lived (15 min)
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' } // Long-lived (7 days)
  );

  return { accessToken, refreshToken };
};

// Verify access token (used in auth middleware)
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw err;
  }
};

// Verify refresh token and issue new access token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    throw err;
  }
};
```

**Token Structure**:
```javascript
// Access Token (15 min, short-lived)
{
  "userId": "abc123",
  "iat": 1713667200,
  "exp": 1713668100
}

// Refresh Token (7 days, long-lived)
{
  "userId": "abc123",
  "iat": 1713667200,
  "exp": 1714272000
}
```

**Why This Design?**
- **Access token**: Short expiry (15 min) → Less exposure if stolen
- **Refresh token**: Long expiry (7 days) → Doesn't require re-login
- **Rotation**: If access token compromised, damage is limited to 15 minutes
- **Revocation**: Refresh tokens can be deleted from DB (true logout)
- **Stateless**: No session storage needed (scalable across servers)

---

### **creditLifecycle.js** - Credit Expiry & Rewards

```javascript
// Expire credits older than 3 months
const expireCreditsIfNeeded = async (userId, prisma) => {
  const membership = await prisma.membership.findUnique({
    where: { userId },
  });

  const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const oldestCredit = await prisma.creditTransaction.findFirst({
    where: {
      userId,
      type: 'TOPUP',
      createdAt: { lte: threeMonthsAgo },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (oldestCredit && membership.creditBalance > 0) {
    const expiredAmount = Math.min(membership.creditBalance, 10); // Max 10 credits/month expiry
    await prisma.membership.update({
      where: { userId },
      data: { creditBalance: { decrement: expiredAmount } },
    });

    await prisma.creditTransaction.create({
      data: {
        userId,
        type: 'DEDUCTION',
        amount: expiredAmount,
        description: 'Credits expired (unused for 90 days)',
      },
    });

    return { creditExpired: expiredAmount };
  }
};

// Send notification 3 days before expiry
const notifyExpiringCredits = async (userId, prisma) => {
  const oldestCredit = await prisma.creditTransaction.findFirst({
    where: {
      userId,
      type: 'TOPUP',
    },
    orderBy: { createdAt: 'asc' },
  });

  if (oldestCredit) {
    const expiryDate = new Date(
      oldestCredit.createdAt.getTime() + 90 * 24 * 60 * 60 * 1000
    );
    const threeDAYSBefore = new Date(expiryDate.getTime() - 3 * 24 * 60 * 60 * 1000);

    if (new Date() >= threeDAYSBefore && new Date() < expiryDate) {
      await prisma.notification.create({
        data: {
          userId,
          type: 'CREDIT_EXPIRING',
          title: 'Credits Expiring Soon',
          body: `Your credits will expire in 3 days. Use them before they're gone!`,
        },
      });
    }
  }
};

// Award 10% bonus on every purchase (loyalty)
const awardSpendReward = async (userId, spendAmount, prisma) => {
  const reward = spendAmount * 0.1;
  await prisma.membership.update({
    where: { userId },
    data: { creditBalance: { increment: reward } },
  });

  await prisma.loyaltyHistory.create({
    data: {
      userId,
      rewardType: 'SPEND_BONUS',
      creditsAwarded: reward,
      reason: `10% loyalty bonus on ₱${spendAmount} purchase`,
    },
  });
};
```

**Why This Logic?**
- **Credit expiry**: Forces spending (prevents "dead" credits sitting indefinitely)
- **Notification system**: Gives members chance to use credits before expiry
- **Spend rewards**: 10% rebate = repeat customers, higher AOV
- **Loyalty**: Creates community feeling + increases lifetime value

---

### **mailer.js** - Email Sending

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendMailSafe = async ({ to, subject, text, html }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email sent to ${to}:`, info.response);
    return true;
  } catch (err) {
    console.error(`Email failed to ${to}:`, err);
    // Don't throw - email failure shouldn't block user operations
    return false;
  }
};

module.exports = { sendMailSafe };
```

**Usage**:
```javascript
// Email verification
await sendMailSafe({
  to: email,
  subject: 'Verify your Saturday Nights account',
  html: `<a href="...verify-token...">Click here to verify</a>`,
});

// Password reset
await sendMailSafe({
  to: email,
  subject: 'Reset your password',
  html: `<a href="...reset-token...">Reset Password</a>`,
});
```

---

### **seed.js** - Database Initialization

```javascript
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');

const seed = async () => {
  console.log('🌱 Seeding database...');

  // Clear existing data
  await prisma.user.deleteMany();
  await prisma.billiardTable.deleteMany();
  await prisma.product.deleteMany();

  // Create demo users
  const admin = await prisma.user.create({
    data: {
      email: 'admin@billiards.com',
      phone: '09123456789',
      password: await bcrypt.hash('admin123', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isEmailVerified: true,
    },
  });

  const member = await prisma.user.create({
    data: {
      email: 'member@billiards.com',
      phone: '09987654321',
      password: await bcrypt.hash('member123', 10),
      firstName: 'John',
      lastName: 'Doe',
      role: 'MEMBER',
      isEmailVerified: true,
    },
  });

  await prisma.membership.create({
    data: { userId: member.id, creditBalance: 500 },
  });

  // Create tables
  for (let i = 1; i <= 20; i++) {
    await prisma.billiardTable.create({
      data: {
        tableNumber: i,
        type: i <= 5 ? 'VIP' : 'STANDARD',
        ratePerHour: i <= 5 ? 100 : 60,
      },
    });
  }

  // Create products
  await prisma.product.createMany({
    data: [
      { name: 'Iced Tea', category: 'Beverage', price: 35, stock: 100 },
      { name: 'Beer', category: 'Beverage', price: 75, stock: 50 },
      { name: 'Burger', category: 'Food', price: 120, stock: 30 },
      { name: 'Chips', category: 'Snack', price: 30, stock: 200 },
    ],
  });

  console.log('✅ Seeding complete!');
};

seed().catch(console.error);
```

**Run with**: `npm run db:seed`

---

## ARCHITECTURE DECISIONS

### 1. **Express.js (REST API Framework)**

**Chosen Over**:
- Django (Python) → Overkill, slower Python startup
- Rails (Ruby) → Language learning curve for team
- FastAPI (Python) → Limited Socket.io integration
- Next.js (Node.js) → Not meant for backend-only APIs

**Why Express?**
- ✅ Lightweight, minimal overhead (fast startup)
- ✅ Massive npm ecosystem (2M packages)
- ✅ Perfect for real-time with Socket.io
- ✅ Team familiar with JavaScript
- ✅ Industry standard (used by Uber, Netflix, PayPal)
- ❌ Less opinionated (requires discipline to avoid "spaghetti code")

---

### 2. **PostgreSQL (Relational Database)**

**Chosen Over**:
- MongoDB (NoSQL) → Complex business logic needs JOINs
- Firebase (NoSQL) → Vendor lock-in, limited query flexibility
- MySQL (SQL) → Similar, but PostgreSQL has better JSON support + JSONB

**Why PostgreSQL?**
- ✅ Relational (perfect for complex business logic)
- ✅ ACID compliance (transaction safety for billing = no money lost)
- ✅ JSON support (flexibility when needed)
- ✅ Supabase = managed (no DevOps needed)
- ✅ Full-text search, arrays, ranges (advanced features)
- ❌ Not ideal for real-time streaming (mitigated by Socket.io)

---

### 3. **Prisma ORM**

**Chosen Over**:
- TypeORM → More boilerplate, steeper learning curve
- Sequelize → Older library, less modern syntax
- Raw SQL → No type safety, SQL injection risk, verbose
- Knex.js → Query builder, not full ORM (more manual work)

**Why Prisma?**
- ✅ Type-safe queries (catches errors at dev time)
- ✅ Auto-migrations (`prisma db push`)
- ✅ Built-in relation support (auto JOINs)
- ✅ Prisma Studio (visual database editor)
- ✅ Prevents SQL injection (parameterized queries)
- ✅ Generated TypeScript types (great IDE autocomplete)
- ❌ Slightly slower than raw SQL (negligible for this scale)

---

### 4. **Socket.IO (Real-time Communication)**

**Chosen Over**:
- WebSockets (raw) → More boilerplate, no fallback
- Server-Sent Events (SSE) → One-directional only
- Polling → Wasteful, expensive, high latency
- GraphQL Subscriptions → Overkill for this use case

**Why Socket.IO?**
- ✅ Fallback to HTTP polling if WebSocket unavailable
- ✅ Rooms-based broadcasting (target staff/TV/members separately)
- ✅ Mobile-friendly (works on Expo)
- ✅ Auto-reconnect with backpressure
- ✅ Event-driven architecture (intuitive)
- ❌ Stateful (harder to scale horizontally, needs Redis adapter)

**Real-time Use Cases**:
- TV display updates instantly when table becomes available
- Staff tablet notified of new queue members/orders
- Tournament brackets update live as matches complete
- Members see queue position in real-time

---

### 5. **JWT Authentication (Stateless)**

**Chosen Over**:
- Session cookies → Server-side storage, hard to scale
- OAuth2 → Overkill for internal API
- API Keys → Not suitable for user authentication

**Why JWT?**
- ✅ Stateless (no session DB needed, scalable)
- ✅ Works across multiple servers
- ✅ Works on mobile (fits in headers)
- ✅ Token expiry built-in
- ✅ Refresh token rotation (security best practice)
- ❌ Can't revoke tokens immediately (mitigated by short expiry)

**Flow**:
1. Login with email + password → Issue access token (15 min) + refresh token (7 days)
2. API requests include `Authorization: Bearer <accessToken>`
3. If access token expires → Client uses refresh token to get new one
4. If refresh token invalid → Re-login required

---

### 6. **Middleware Pattern (Security)**

**Why?**
- ✅ Centralized security logic (no accidental unprotected routes)
- ✅ Easy to add authentication/authorization
- ✅ Audit trail (logging middleware)
- ✅ DRY principle (don't repeat auth checks)

```javascript
// Middleware protects route
router.post('/create-tournament',
  authenticate,            // Verify JWT
  authorize('ADMIN'),      // Check role
  controller.createTournament
);
```

---

### 7. **Atomic Transactions (Billing Safety)**

**Example**:
```javascript
await prisma.$transaction(async (tx) => {
  // All 3 operations succeed OR all 3 fail (atomicity)
  await tx.membership.update({ ... }); // Deduct credits
  await tx.tableSession.update({ ... }); // Update session
  await tx.creditTransaction.create({ ... }); // Audit trail
});
```

**Why?**
- ✅ Prevents partial updates (e.g., credit deducted but session not updated)
- ✅ No money lost to bugs
- ✅ Handles race conditions (multiple requests at same time)

---

## BUSINESS LOGIC FLOWS

### **Flow 1: Member Registration & Email Verification**

```
1. Mobile App → POST /api/auth/register
   {
     email: "user@gmail.com",
     password: "securepass",
     firstName: "John",
     lastName: "Doe"
   }

2. Backend → auth.controller.register()
   - Validate input
   - Check if email exists
   - Hash password with bcryptjs (10 salt rounds)
   - Generate 24-hour verification token
   - Create User + Membership + GamifiedProfile
   - Send verification email

3. Email (from nodemailer) → Verify Email Link
   - Contains: {BACKEND_URL}/api/auth/verify-email?token=abc123...

4. User clicks link → Backend → auth.controller.verifyEmail()
   - Verify token not expired
   - Mark isEmailVerified = true
   - Clear verification token

5. User can now login with email + password
```

---

### **Flow 2: Login & Get Access Token**

```
1. Mobile App → POST /api/auth/login
   {
     email: "user@gmail.com",
     password: "securepass"
   }

2. Backend → auth.controller.login()
   - Find user by email
   - Compare password with bcryptjs.compare() (1-way hash)
   - Check if email verified
   - Generate JWT tokens:
     - accessToken (15 min) - for API requests
     - refreshToken (7 days) - for getting new access token
   - Store refresh token in DB (revocable)

3. Response → Mobile App
   {
     accessToken: "eyJhbGciOiJIUzI1NiIs...",
     refreshToken: "eyJhbGciOiJIUzI1NiIs...",
     user: { id, email, role }
   }

4. Mobile App stores tokens in secure storage:
   - accessToken → Memory (cleared on app close)
   - refreshToken → Encrypted local storage
```

---

### **Flow 3: Member Joins Queue**

```
1. Member App → POST /api/queue/join
   {
     tableId: "table-5"
   }
   Header: Authorization: Bearer {accessToken}

2. Backend → auth.middleware.authenticate()
   - Extract token from header
   - Verify JWT signature (no tampering)
   - Verify token not expired
   - Fetch user from DB (catches banned users)
   - Attach user to request

3. Backend → authorize('MEMBER', 'ADMIN')
   - Check user.role matches

4. Backend → queue.controller.joinQueue()
   - Check if already in queue
   - Count existing queue entries (for position)
   - Determine priority (PREMIUM = +1)
   - Create QueueEntry in DB
   - Position = current count + 1

5. Socket.IO Broadcast (Real-time)
   - Emit to `table:5` room → All clients watching table 5
   - Emit to `tv-display` room → TV updates visible queue
   - Emit to `staff-tablet` room → Staff sees new queue member

6. Response → Mobile App
   {
     id: "queue-entry-123",
     position: 3,
     status: "WAITING"
   }

7. Member sees: "You are #3 in queue, ~1.5 hours wait"
```

---

### **Flow 4: Table Session Billing (Every 5 Seconds)**

```
Background Job: syncActiveSessions() runs every 5 seconds

1. Find all ACTIVE table sessions:
   SELECT * FROM table_sessions WHERE status = 'ACTIVE'

2. For each session:
   - Get member's credit balance
   - Calculate elapsed time = (now - startTime) in hours
   - Calculate cost = elapsed_hours * table.ratePerHour
   - Calculate amount to charge = cost - already_charged

3. If credits sufficient:
   - Deduct from membership.creditBalance
   - Update session.creditsUsed
   - Create CreditTransaction (audit trail)
   - Broadcast to staff/TV (updated billing info)

4. If credits insufficient:
   - End session
   - Mark table as AVAILABLE
   - Notify staff "Table 5 available, credits exhausted"
   - Member can immediately top up and rejoin queue

Example:
- Member starts at 10:00 AM with 100 credits
- Rate: 60 PHP/hour = 1 credit/minute
- 10:05 AM (5 min elapsed): Charge 5 credits, balance = 95
- 10:10 AM (10 min elapsed): Charge 5 credits, balance = 90
- ... repeats every 5 seconds
- 11:30 AM (90 min elapsed): All 100 credits used, session ends automatically
```

---

### **Flow 5: Reservation Auto-Starts (Every 30 Seconds)**

```
Background Job: syncScheduledReservations() runs every 30 seconds

1. Admin creates tournament:
   - SET a table reservation for Friday 6:00 PM
   - Status = PENDING

2. Admin approves reservation:
   - Status = APPROVED
   - Now waiting for startTime

3. Friday 6:00 PM arrives:
   - syncScheduledReservations() finds APPROVED reservation where startTime <= now
   - Check if session already exists (prevent duplicate)
   - Create TableSession:
     - tableId = reserved table
     - userId = member ID (or null if cash payment)
     - status = ACTIVE
     - startTime = now
   - Update BilliardTable status = OCCUPIED

4. Socket.IO Broadcast:
   - Emit to `staff-tablet` → Staff sees table assignment
   - Emit to `tv-display` → TV shows occupied table
   - Emit to `member-app` → Member notified "Table is ready"

5. sessionMonitor takes over:
   - Every 5 seconds, auto-deduct credits as they play
```

---

### **Flow 6: Purchase Order (POS)**

```
1. Member adds items to cart in Staff POS:
   [
     { productId: "burger-1", quantity: 2 },
     { productId: "beer-1", quantity: 1 }
   ]

2. Member selects payment method (CASH or CREDIT_CARD)

3. Staff → POST /api/orders
   Header: Authorization: Bearer {staffToken}
   Body: { items: [...], memberId: "user-123" }

4. Backend → pos.controller.createOrder()
   - Validate stock availability
   - Create Order + OrderItems (in transaction)
   - Deduct stock
   - Return order total

5. Response → Staff POS
   {
     orderId: "order-456",
     total: 245 PHP,
     items: [...]
   }

6. Staff processes payment (CASH or card terminal)

7. Staff → POST /api/orders/{orderId}/payment
   { method: "CASH" }

8. Backend → pos.controller.processPayment()
   - Create Payment record (status = COMPLETED)
   - Update Order status = PAID
   - Award loyalty reward: 245 * 0.1 = 24.5 credits
   - Create CreditTransaction (audit trail)
   - Send notification to member: "Your order is ready! +24.5 credits earned"

9. Member sees in app:
   - Order history entry
   - +24.5 credits added to balance
```

---

### **Flow 7: Tournament Match Result**

```
1. Tournament created:
   - Format: SINGLE_ELIMINATION
   - Max players: 16
   - Entry fee: 50 credits
   - Prize pool: 5000 PHP

2. Members register (auto-generate bracket):
   - Player 1 (John) vs Player 2 (Jane) - Match 1
   - Player 3 (Bob) vs Player 4 (Alice) - Match 2
   - ...
   - All 16 players placed in bracket

3. Matches play out, staff updates results:

   Match 1: John vs Jane
   - Staff → POST /api/tournaments/{id}/match/{matchId}/result
     { winnerId: "john-123" }
   
4. Backend → tournament.controller.updateMatchResult()
   - Update match.winnerId = john-123
   - Award XP to winner:
     - john_profile.xp += 50
     - john_profile.totalWins += 1
     - john_profile.winStreak += 1
   - Update loser (jane):
     - jane_profile.totalLosses += 1
     - jane_profile.winStreak = 0
   - Create notification: "Match completed! John wins. +50 XP"
   - Bracket automatically updates next match

5. Socket.IO Broadcast:
   - Emit to `tournament:{id}` → All members watching see live bracket
   - Emit leaderboard update → John moves up in rankings

6. Final match: Tournament champion crowned
   - Award prize money (from prize pool)
   - Promote to next rank if applicable (Rookie → Hustler)
   - Award special badge: "Tournament Winner"
   - Broadcast achievement to all members
```

---

## SECURITY MEASURES

| Feature | Purpose | Implementation |
|---------|---------|-----------------|
| **Password Hashing** | Prevent passwords being stolen | bcryptjs (10 salt rounds, 200ms compute) |
| **JWT Signatures** | Prevent token tampering | HS256 (HMAC-SHA256) |
| **Token Expiry** | Limit exposure if token stolen | Access token 15min, refresh token 7 days |
| **Rate Limiting** | Prevent brute-force attacks | 20 auth attempts / 15 minutes |
| **Helmet.js** | HTTP security headers | Prevents XSS, clickjacking, MIME sniffing |
| **CORS** | Only allow trusted domains | `FRONTEND_URL` environment variable |
| **Role-Based Access** | Prevent unauthorized operations | ADMIN/STAFF/MEMBER/WALKIN roles |
| **SQL Injection Prevention** | Prevent SQL attacks | Prisma parameterized queries |
| **Email Verification** | Confirm user owns email | 24-hour expiry token |
| **Transactions** | Prevent partial billing | Atomic database transactions |
| **Input Validation** | Reject malformed data | express-validator library |
| **Audit Trail** | Track all credit movements | CreditTransaction model |
| **Refresh Token Rotation** | Force re-login periodically | Tokens stored in DB (revocable) |

---

## DEFENSE TALKING POINTS

### **Q: Why Express.js instead of Django/Flask/Fastapi?**

**A:** Express.js is lightweight and integrates perfectly with Socket.IO for real-time features. Our system needs live table status updates (Queue on TV display, tournament brackets, staff notifications). Express + Socket.IO is the industry standard for this (Uber, Slack use similar). Python frameworks have slower startup times and weaker real-time support. Plus, our team is more comfortable with JavaScript.

---

### **Q: Why PostgreSQL instead of MongoDB?**

**A:** We have complex business logic requiring JOINs (e.g., finding all of a member's transactions, reservations, tournament entries). Relational databases are designed for this. MongoDB's document model would require denormalization, leading to data inconsistency (e.g., updating a member's name requires changes in multiple documents).

Additionally, PostgreSQL's ACID compliance is critical for billing. If a credit deduction fails halfway, PostgreSQL's transactions guarantee we can rollback everything, preventing money loss.

---

### **Q: Why Prisma instead of writing raw SQL?**

**A:** Prisma provides type safety (catches errors at development time), auto-migrations, and built-in relation support. It prevents SQL injection automatically. For a team project, this reduces bugs and accelerates development. Prisma Studio also provides visual database debugging, which is invaluable when diagnosing data issues.

---

### **Q: How do you prevent double-charging in billing?**

**A:** We use Prisma's `$transaction()` wrapper for atomic operations. If credit deduction fails, the entire session update rolls back. This ensures "all-or-nothing" behavior. Additionally, we lock the rate at session start, so price changes don't affect ongoing play.

---

### **Q: How does real-time notification work?**

**A:** Socket.IO maintains persistent WebSocket connections between server and clients. When an event occurs (e.g., table becomes available), the server broadcasts to all connected clients in specific "rooms" (e.g., `tv-display`, `staff-tablet`). This is instant (milliseconds) compared to polling (seconds of delay).

---

### **Q: What if a member runs out of credits mid-game?**

**A:** `sessionMonitor` checks every 5 seconds. When credits hit 0, we auto-end the session and notify staff "Table available, credits exhausted". The member can immediately top up credits via the app and rejoin the queue.

---

### **Q: How is credit expiry handled?**

**A:** Every time a member makes a request (`auth.middleware`), we call `expireCreditsIfNeeded()`. Credits older than 3 months are auto-expired. We send a notification 3 days before expiry. This encourages spending and prevents dead credits.

---

### **Q: Why not store sessions in Redis?**

**A:** We keep everything in PostgreSQL for simplicity. Redis adds operational complexity (another service to manage, cluster setup, persistence configuration). For our scale (~100 concurrent users), PostgreSQL is sufficient. If we grow to 10,000+ concurrent users, we'd add Redis for caching.

---

### **Q: How do you handle role-based access control (RBAC)?**

**A:** We use `authorize('ADMIN', 'STAFF')` middleware on routes. The middleware checks if `user.role` matches allowed roles. This prevents non-admin users from accessing admin endpoints. Each controller function only runs if the user passes all middleware checks.

---

### **Q: Why use Socket.IO instead of polling?**

**A:** Polling wastes bandwidth (constant HTTP requests). Socket.IO maintains a persistent connection, so the server can push updates instantly. Polling with 1-second intervals would require 86,400 requests/day per client. Socket.IO also has automatic reconnection and fallback to long-polling if WebSocket unavailable.

---

### **Q: How do you prevent brute-force password attacks?**

**A:** We use `express-rate-limit` with a strict limit (20 login attempts per 15 minutes). After 20 failed attempts, the client gets a 429 "Too Many Requests" response. Additionally, passwords are hashed with bcryptjs (200ms compute), so even with rate limiting bypassed, cracking is slow.

---

### **Q: How do you handle payment failures gracefully?**

**A:** We wrap payment operations in transactions. If payment fails, we create a Payment record with `status: FAILED` and don't deduct credits. The order remains in `PENDING` status. Staff can retry or cancel. This prevents losing money to bugs.

---

### **Q: Why JWT instead of session cookies?**

**A:** JWT is stateless (no server-side session storage needed). This makes it easy to scale horizontally (multiple servers). Cookies are domain-restricted, making them harder to use with mobile apps. JWT tokens fit perfectly in mobile `Authorization` headers.

---

### **Q: How do you ensure data consistency in concurrent scenarios?**

**A:** Atomic transactions + row-level locking. If two requests try to deduct credits simultaneously, PostgreSQL serializes them (one succeeds, one waits). The transaction ensures both balance and audit trail update together, or neither updates.

---

## DEPLOYMENT CONSIDERATIONS

### **Database**: Supabase (Managed PostgreSQL)
- Automatic backups
- Point-in-time recovery
- Replication for high availability
- Monitoring & alerts

### **Backend**: Render.com or Railway.app
- Auto-deploy from GitHub
- Environment variables support
- Horizontal scaling (multiple instances)
- Built-in monitoring

### **Real-time Scaling**: Redis Adapter
- If multiple server instances, use Redis to share Socket.IO state
- Ensures messages broadcast across all servers

### **Email Service**: SendGrid or AWS SES
- Gmail has strict rate limits (300/day)
- SendGrid: 100 free emails/day, then paid
- AWS SES: $0.10 per 1000 emails

### **Monitoring**: Sentry + DataDog
- **Sentry**: Catch runtime errors, send alerts
- **DataDog**: Monitor API response times, database performance
- **Prometheus**: Metrics scraping for Kubernetes (if scaling further)

### **CI/CD Pipeline**: GitHub Actions
```yaml
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm test
      - run: npx prisma migrate
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: git push origin main (Render auto-deploys)
```

---

## CONCLUSION

This backend system is built for **scalability, security, and automation**. The modular Express architecture allows easy feature additions. Prisma ensures data consistency and prevents common bugs. Socket.IO enables real-time engagement. Atomic transactions guarantee accurate billing. Role-based middleware protects sensitive operations.

Good luck with your defense! 🎱

