const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Send a verification email.
 * Replace the console.log stub with your real email provider
 * (e.g. Nodemailer + Gmail, SendGrid, Resend, etc.)
 */
const sendVerificationEmail = async (email, token) => {
  // TODO: plug in a real email sender here.
  // The link below works for both local dev and Render:
  const verifyUrl = `${process.env.BACKEND_URL || 'https://billiard-system.onrender.com'}/api/auth/verify-email?token=${token}`;
  console.log(`[Email Verification] Send to ${email}: ${verifyUrl}`);
  // Example with nodemailer (install it first):
  // await transporter.sendMail({
  //   to: email,
  //   subject: 'Verify your Saturday Nights Billiard account',
  //   html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email. Link expires in 24 hours.</p>`,
  // });
};

// ─── Validation Rules ───────────────────────────────────────────────────────

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),
  body('phone')
    .matches(/^(\+63|0)[0-9]{10}$/)
    .withMessage('Must be a valid Philippine phone number (e.g. 09171234567)'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('firstName').trim().isLength({ min: 2 }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: 2 }).withMessage('Last name is required'),
  body('dateOfBirth').optional().isISO8601().withMessage('Invalid date format'),
  body('displayName').optional().trim().isLength({ min: 2 }),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Must be a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];

// Used when Admin creates a Staff account
const createStaffValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),
  body('phone')
    .matches(/^(\+63|0)[0-9]{10}$/)
    .withMessage('Must be a valid Philippine phone number (e.g. 09171234567)'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Must contain at least one number'),
  body('firstName').trim().isLength({ min: 2 }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: 2 }).withMessage('Last name is required'),
];

// ─── Register (Members only — public endpoint) ──────────────────────────────

const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, phone, password, firstName, lastName, dateOfBirth, displayName, pushToken } = req.body;

  try {
    // Check for duplicate email / phone
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ error: `${field} is already registered` });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate a secure email verification token (valid 24 h)
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          pushToken: pushToken || null,
          role: 'MEMBER',
          isEmailVerified: false,
          emailVerifyToken,
          emailVerifyExpires,
        },
      });

      // Auto-create membership (inactive until email is verified)
      await tx.membership.create({
        data: {
          userId: newUser.id,
          plan: 'BASIC',
          status: 'INACTIVE', // activated after email verification
          creditBalance: 0,
        },
      });

      // Auto-create gamified profile
      const dName = displayName?.trim() || `${firstName} ${lastName}`;
      await tx.gamifiedProfile.create({
        data: {
          userId: newUser.id,
          displayName: dName,
          level: 1,
          xp: 0,
          rank: 'Rookie',
        },
      });

      return newUser;
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(email, emailVerifyToken).catch((err) =>
      console.error('[Email Send Error]', err)
    );

    // Do NOT issue tokens yet — user must verify email first
    res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account before logging in.',
      requiresEmailVerification: true,
    });
  } catch (err) {
    console.error('[Register Error]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// ─── Verify Email ────────────────────────────────────────────────────────────

const verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Verification token is required' });

  try {
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
        emailVerifyExpires: { gte: new Date() }, // not expired
      },
    });

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired verification link. Please register again or request a new link.',
      });
    }

    // Mark email as verified and activate membership
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          emailVerifyToken: null,
          emailVerifyExpires: null,
        },
      }),
      prisma.membership.update({
        where: { userId: user.id },
        data: { status: 'ACTIVE' },
      }),
    ]);

    // Return a simple success page or JSON (mobile deep-link can handle this)
    res.json({
      message: '✅ Email verified! Your account is now active. You can log in.',
      verified: true,
    });
  } catch (err) {
    console.error('[Verify Email Error]', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
};

// ─── Resend Verification Email ────────────────────────────────────────────────

const resendVerification = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return 200 to avoid leaking which emails are registered
    if (!user || user.isEmailVerified) {
      return res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
    }

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken, emailVerifyExpires },
    });

    sendVerificationEmail(email, emailVerifyToken).catch(console.error);

    res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
  } catch (err) {
    console.error('[Resend Verification Error]', err);
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
};

// ─── Admin: Create Staff Account ─────────────────────────────────────────────

const createStaff = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Only admins can reach this endpoint (enforced by middleware too)
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only admins can create staff accounts' });
  }

  const { email, phone, password, firstName, lastName } = req.body;

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ error: `${field} is already registered` });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Staff accounts are pre-verified — no email flow needed
    const staff = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role: 'STAFF',
        isEmailVerified: true, // admin-created accounts skip email verification
      },
    });

    // Log the admin action
    await prisma.staffAction.create({
      data: {
        staffId: req.user.id,
        action: 'CREATE_STAFF_ACCOUNT',
        targetId: staff.id,
        details: { email, firstName, lastName },
      },
    });

    res.status(201).json({
      message: `Staff account created for ${firstName} ${lastName}`,
      staff: {
        id: staff.id,
        email: staff.email,
        phone: staff.phone,
        firstName: staff.firstName,
        lastName: staff.lastName,
        role: staff.role,
      },
    });
  } catch (err) {
    console.error('[Create Staff Error]', err);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────

const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, pushToken } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        membership: true,
        gamifiedProfile: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Block login if email is not verified (members only — staff/admin are pre-verified)
    if (!user.isEmailVerified && user.role === 'MEMBER') {
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        requiresEmailVerification: true,
        email: user.email,
      });
    }

    // Update push token if provided
    if (pushToken && pushToken !== user.pushToken) {
      await prisma.user.update({ where: { id: user.id }, data: { pushToken } });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Birthday bonus check
    const today = new Date();
    const dob = user.dateOfBirth ? new Date(user.dateOfBirth) : null;
    const isBirthday =
      dob &&
      dob.getMonth() === today.getMonth() &&
      dob.getDate() === today.getDate();

    if (isBirthday && user.membership) {
      const thisYear = today.getFullYear();
      const alreadyRewarded = await prisma.loyaltyHistory.findFirst({
        where: {
          userId: user.id,
          trigger: 'BIRTHDAY',
          createdAt: {
            gte: new Date(`${thisYear}-01-01`),
            lte: new Date(`${thisYear}-12-31`),
          },
        },
      });

      if (!alreadyRewarded) {
        const birthdayCredits = parseFloat(process.env.BIRTHDAY_FREE_CREDITS) || 60;
        await prisma.$transaction([
          prisma.membership.update({
            where: { userId: user.id },
            data: { creditBalance: { increment: birthdayCredits } },
          }),
          prisma.loyaltyHistory.create({
            data: {
              userId: user.id,
              trigger: 'BIRTHDAY',
              creditsAwarded: birthdayCredits,
              description: `🎂 Happy Birthday! You earned ${birthdayCredits} free credits (1 hour)!`,
            },
          }),
          prisma.notification.create({
            data: {
              userId: user.id,
              type: 'BIRTHDAY_REWARD',
              title: '🎂 Happy Birthday!',
              message: `Enjoy ${birthdayCredits} free credits from Saturday Nights Billiard!`,
            },
          }),
        ]);
      }
    }

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        membership: user.membership,
        gamifiedProfile: user.gamifiedProfile,
      },
    });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findFirst({
      where: { token: refreshToken, userId: decoded.userId },
    });

    if (!stored || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    const tokens = generateTokens(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
  res.json({ message: 'Logged out successfully' });
};

// ─── Get current user (me) ────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { membership: true, gamifiedProfile: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, emailVerifyToken, emailVerifyExpires, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  createStaff,
  login,
  refresh,
  logout,
  getMe,
  registerValidation,
  loginValidation,
  createStaffValidation,
};
