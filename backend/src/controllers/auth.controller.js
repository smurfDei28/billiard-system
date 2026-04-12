const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');

// ─── Validation Rules ───
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

// ─── Register ───
const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, phone, password, firstName, lastName, dateOfBirth, displayName, pushToken } = req.body;

  try {
    // Check existing
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ error: `${field} is already registered` });
    }

    // Hash password with salt rounds 12
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with membership and gamified profile in transaction
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
        },
      });

      // Auto-create membership
      await tx.membership.create({
        data: {
          userId: newUser.id,
          plan: 'BASIC',
          status: 'ACTIVE',
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

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.status(201).json({
      message: 'Registration successful!',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[Register Error]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// ─── Login ───
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

    // Update push token if provided
    if (pushToken && pushToken !== user.pushToken) {
      await prisma.user.update({ where: { id: user.id }, data: { pushToken } });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Check if today is birthday
    const today = new Date();
    const dob = user.dateOfBirth ? new Date(user.dateOfBirth) : null;
    const isBirthday = dob &&
      dob.getMonth() === today.getMonth() &&
      dob.getDate() === today.getDate();

    if (isBirthday && user.membership) {
      // Check if birthday reward already given this year
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
        membership: user.membership,
        gamifiedProfile: user.gamifiedProfile,
      },
    });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// ─── Refresh Token ───
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

    // Delete old token, issue new one
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

// ─── Logout ───
const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
  res.json({ message: 'Logged out successfully' });
};

module.exports = { register, login, refresh, logout, registerValidation, loginValidation };
