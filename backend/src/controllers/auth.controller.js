const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PH_PHONE_PATTERN, normalizeOptionalPhone } = require('../utils/phone');
const prisma = require('../config/prisma');
const { generateTokens, verifyRefreshToken, getRefreshTokenExpiresAt } = require('../utils/jwt');
const { sendMailSafe } = require('../utils/mailer');
const { hasValidPassword, passwordPolicyMessage } = require('../utils/passwordPolicy');
const { presentGamifiedProfile } = require('../utils/gamification');

const maskEmail = (email) => {
  const [local, domain] = String(email || '').split('@');
  return domain ? `${local.slice(0, 2)}***@${domain}` : 'unknown-recipient';
};

const tokenFingerprint = (token) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
const verificationLog = (event, details = {}) => console.info(`[Email Verification] ${event}`, details);

// ─── Helpers ───────────────────────────────────────────────────────────────

const getPublicBackendUrl = () => {
  const configuredUrl = process.env.BACKEND_URL?.trim();
  if (!configuredUrl) {
    throw new Error('BACKEND_URL must be configured with the public API URL before verification emails can be sent.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error('BACKEND_URL must be a valid absolute HTTP or HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('BACKEND_URL must use HTTP or HTTPS.');
  }
  return configuredUrl.replace(/\/+$/, '');
};

const getMobileEmailVerifiedUrl = () => {
  const configuredUrl = process.env.MOBILE_EMAIL_VERIFIED_URL?.trim();
  if (configuredUrl) return configuredUrl;

  const scheme = (process.env.MOBILE_APP_SCHEME || 'saturdaynights').replace(/[^a-zA-Z0-9+.-]/g, '');
  return `${scheme || 'saturdaynights'}://email-verified`;
};

const getMobileLoginUrl = () => {
  const configuredUrl = process.env.MOBILE_LOGIN_URL?.trim();
  if (configuredUrl) return configuredUrl;

  const scheme = (process.env.MOBILE_APP_SCHEME || 'saturdaynights').replace(/[^a-zA-Z0-9+.-]/g, '');
  return `${scheme || 'saturdaynights'}://`;
};

const renderEmailVerifiedPage = () => {
  const appUrl = getMobileEmailVerifiedUrl();
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Email Verified Successfully</title>
      </head>
      <body style="margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; background:#0A0E1A; color:#FFFFFF; font-family:Arial,Helvetica,sans-serif;">
        <main style="width:100%; max-width:430px; box-sizing:border-box; padding:34px 26px; text-align:center; border:1px solid #2A3550; border-radius:20px; background:#131929;">
          <div style="width:76px; height:76px; box-sizing:border-box; margin:0 auto 22px; border:8px solid #00C896; border-radius:50%; color:#00C896; font-size:43px; font-weight:800; line-height:58px;">✓</div>
          <div style="margin-bottom:10px; color:#FFFFFF; font-size:25px; font-weight:800; line-height:1.25;">Email Verified Successfully</div>
          <p style="margin:0 0 26px; color:#8B9EC4; font-size:15px; line-height:1.55;">Your account is now active. Opening Saturday Nights Billiard…</p>
          <a href="${appUrl}" style="display:inline-block; box-sizing:border-box; width:100%; padding:15px 18px; border-radius:12px; background:#00C896; color:#06110E; font-size:16px; font-weight:800; text-decoration:none;">Open Saturday Nights Billiard</a>
          <p style="margin:18px 0 0; color:#5A6B8A; font-size:12px; line-height:1.5;">If the app does not open automatically, use the button above.</p>
        </main>
        <script>window.setTimeout(function () { window.location.href = ${JSON.stringify(appUrl)}; }, 250);</script>
      </body>
    </html>`;
};

/** Send a verification email with a one-time link. */
const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${getPublicBackendUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  verificationLog('email template created', {
    to: maskEmail(email),
    tokenId: tokenFingerprint(token),
    verifyUrlOrigin: new URL(verifyUrl).origin,
  });

  const subject = 'Verify your Saturday Nights Billiard account';
  const text =
    `Welcome to Saturday Nights Billiard!\n\n` +
    `Verify your email using this link (expires in 24 hours):\n${verifyUrl}\n\n` +
    `If you did not create an account, you can ignore this email.`;

  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style="margin:0; padding:24px 12px; background:#0A0E1A; font-family:Arial,Helvetica,sans-serif; color:#FFFFFF;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; background:#131929; border:1px solid #2A3550; border-radius:16px; overflow:hidden;">
              <tr><td style="padding:32px 28px 20px; text-align:center; border-bottom:1px solid #2A3550;">
                <div style="width:52px; height:52px; margin:0 auto 14px; border:2px solid #00C896; border-radius:50%; background:#1E2740; color:#00C896; font-size:28px; line-height:52px;">&#127921;</div>
                <div style="font-size:24px; font-weight:800; letter-spacing:.4px; color:#FFFFFF;">Saturday Nights</div>
                <div style="margin-top:4px; font-size:12px; font-weight:700; letter-spacing:3px; color:#00C896;">BILLIARD</div>
              </td></tr>
              <tr><td style="padding:30px 28px 12px;">
                <h1 style="margin:0 0 14px; font-size:24px; line-height:1.25; color:#FFFFFF;">Verify your email address</h1>
                <p style="margin:0 0 18px; font-size:16px; line-height:1.55; color:#C7D2E8;">Welcome to Saturday Nights Billiard. Confirm your email address to activate your account and sign in.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 20px;"><tr><td style="border-radius:10px; background:#00C896;">
                  <a href="${verifyUrl}" style="display:inline-block; padding:14px 22px; border-radius:10px; color:#06110E; font-size:16px; font-weight:800; text-decoration:none;">Verify Email</a>
                </td></tr></table>
                <p style="margin:0 0 8px; font-size:13px; line-height:1.5; color:#8B9EC4;">This one-time link expires in <strong style="color:#FFFFFF;">24 hours</strong>.</p>
                <p style="margin:0; font-size:13px; line-height:1.5; color:#8B9EC4;">If the button does not work, copy this link into your browser:</p>
                <p style="margin:8px 0 0; font-size:12px; line-height:1.5; overflow-wrap:anywhere;"><a href="${verifyUrl}" style="color:#33D4AC; text-decoration:underline;">${verifyUrl}</a></p>
              </td></tr>
              <tr><td style="padding:20px 28px 28px;">
                <p style="margin:0; font-size:12px; line-height:1.5; color:#5A6B8A;">If you did not create this account, you can safely ignore this email.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>`;

  const result = await sendMailSafe({ to: email, subject, text, html });
  verificationLog('email accepted by SMTP provider', {
    to: maskEmail(email),
    tokenId: tokenFingerprint(token),
    messageId: result.messageId,
  });
};

const sendPasswordResetEmail = async (email, token) => {
  const resetBaseUrl = getPublicBackendUrl();
  if (process.env.NODE_ENV !== 'production') {
    const publicUrl = new URL(resetBaseUrl);
    console.info('[Forgot Password]', {
      environment: process.env.NODE_ENV || 'development',
      protocol: publicUrl.protocol,
      host: publicUrl.host,
      resetBaseUrl,
    });
  }
  const resetUrl = `${resetBaseUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  const subject = 'Reset your Saturday Nights Billiard password';
  const text =
    `We received a request to reset your password.\n\n` +
    `Reset link (expires soon):\n${resetUrl}\n\n` +
    `If you did not request this, you can ignore this email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Reset your password</h2>
      <p style="margin: 0 0 12px;">Click the button below to set a new password.</p>
      <p style="margin: 0 0 16px;">
        <a href="${resetUrl}" style="display: inline-block; padding: 10px 14px; background: #F6C84C; color: #000; text-decoration: none; border-radius: 8px; font-weight: 700;">
          Reset Password
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #666;">
        Or copy and paste this URL into your browser:<br/>
        <a href="${resetUrl}">${resetUrl}</a>
      </p>
    </div>
  `;

  await sendMailSafe({ to: email, subject, text, html });
};

// ─── Validation Rules ───────────────────────────────────────────────────────

const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),
  body('phone')
    .customSanitizer(normalizeOptionalPhone)
    .optional({ nullable: true })
    .matches(PH_PHONE_PATTERN)
    .withMessage('Must be a valid Philippine phone number (e.g. 09171234567)'),
  body('password').custom((password) => {
    if (!hasValidPassword(password)) throw new Error(passwordPolicyMessage);
    return true;
  }),
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
    .customSanitizer(normalizeOptionalPhone)
    .optional({ nullable: true })
    .matches(PH_PHONE_PATTERN)
    .withMessage('Must be a valid Philippine phone number (e.g. 09171234567)'),
  body('password').custom((password) => {
    if (!hasValidPassword(password)) throw new Error(passwordPolicyMessage);
    return true;
  }),
  body('firstName').trim().isLength({ min: 2 }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: 2 }).withMessage('Last name is required'),
];

// ─── Register (Members only — public endpoint) ──────────────────────────────

const registerWithDependencies = async (req, res, { db = prisma, sendVerification = sendVerificationEmail } = {}) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, firstName, lastName, dateOfBirth, displayName, pushToken } = req.body;
  const phone = normalizeOptionalPhone(req.body.phone);

  try {
    verificationLog('registration started', { email: maskEmail(email) });
    // Check for duplicate email / phone
    const existing = await db.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    });
    if (existing) {
      if (existing.email === email && !existing.isEmailVerified) {
        verificationLog('registration found an existing unverified account', {
          userId: existing.id,
          email: maskEmail(existing.email),
        });
        return res.status(409).json({
          error: 'This email is already registered but has not been verified. Send a new verification link to continue.',
          requiresEmailVerification: true,
          email: existing.email,
        });
      }
      const field = existing.email === email ? 'Email' : 'Phone number';
      return res.status(409).json({ error: `${field} is already registered` });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate a secure email verification token (valid 24 h)
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    verificationLog('verification token generated', {
      email: maskEmail(email),
      tokenId: tokenFingerprint(emailVerifyToken),
      expiresAt: emailVerifyExpires.toISOString(),
    });

    const user = await db.$transaction(async (tx) => {
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
    verificationLog('unverified account and related records created', {
      userId: user.id,
      email: maskEmail(user.email),
    });

    // Wait for the mail provider to accept the message before telling the
    // client that registration is ready for verification. The account remains
    // inactive if delivery fails, and the client can use the existing resend
    // endpoint after SMTP has been fixed.
    try {
      verificationLog('sending registration verification email', {
        userId: user.id,
        email: maskEmail(email),
        tokenId: tokenFingerprint(emailVerifyToken),
      });
      await sendVerification(email, emailVerifyToken);
    } catch (mailErr) {
      console.error('[Email Verification] registration email failed', {
        userId: user.id,
        email: maskEmail(email),
        tokenId: tokenFingerprint(emailVerifyToken),
        code: mailErr.code || mailErr.name,
        message: mailErr.message,
        responseCode: mailErr.responseCode,
      });
      return res.status(503).json({
        error: 'Your account was created, but we could not send the verification email. Please try sending it again shortly.',
        errorCode: mailErr.message?.includes('BACKEND_URL')
          ? 'EMAIL_LINK_CONFIGURATION_ERROR'
          : 'EMAIL_DELIVERY_FAILED',
        requiresEmailVerification: true,
        email: user.email,
        emailDeliveryFailed: true,
      });
    }
    verificationLog('registration verification email sent', { userId: user.id, email: maskEmail(email) });

    // Do NOT issue tokens yet — user must verify email first
    res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account before logging in.',
      requiresEmailVerification: true,
      email: user.email,
    });
  } catch (err) {
    console.error('[Register Error]', err);
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(' ') : String(err.meta?.target || '');
      return res.status(409).json({ error: target.includes('phone') ? 'Phone number is already registered' : 'Email is already registered' });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

const register = (req, res) => registerWithDependencies(req, res);

// ─── Verify Email ────────────────────────────────────────────────────────────

const verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Verification token is required' });

  try {
    verificationLog('verification link opened', { tokenId: tokenFingerprint(String(token)) });
    const user = await prisma.user.findFirst({
      where: {
        emailVerifyToken: token,
      },
    });

    if (!user) {
      verificationLog('verification link rejected', { tokenId: tokenFingerprint(String(token)), reason: 'not-found-or-used' });
      return res.status(400).json({
        error: 'This verification link is invalid or has already been used. Request a new link if your email is still unverified.',
      });
    }

    if (user.isEmailVerified) {
      verificationLog('verification link already verified', { userId: user.id, tokenId: tokenFingerprint(String(token)) });
      return res.json({
        message: 'Your email is already verified. You can log in.',
        verified: true,
        alreadyVerified: true,
      });
    }

    if (!user.emailVerifyExpires || user.emailVerifyExpires < new Date()) {
      verificationLog('verification link expired', { userId: user.id, tokenId: tokenFingerprint(String(token)) });
      return res.status(410).json({
        error: 'This verification link has expired. Request a new verification link to continue.',
        expired: true,
      });
    }

    // Claim the one-time token atomically. A duplicate/concurrent use cannot
    // activate the account twice or keep a valid token after verification.
    const verified = await prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: {
          id: user.id,
          isEmailVerified: false,
          emailVerifyToken: token,
          emailVerifyExpires: { gte: new Date() },
        },
        data: {
          isEmailVerified: true,
          emailVerifyToken: null,
          emailVerifyExpires: null,
        },
      });

      if (claimed.count !== 1) return false;

      await tx.membership.update({
        where: { userId: user.id },
        data: { status: 'ACTIVE' },
      });
      return true;
    });

    if (!verified) {
      verificationLog('verification token was not claimed', { userId: user.id, tokenId: tokenFingerprint(String(token)) });
      return res.status(400).json({
        error: 'This verification link is invalid, expired, or has already been used.',
      });
    }

    // The browser page immediately opens the mobile deep link and offers a
    // button fallback for email clients that block automatic app launches.
    verificationLog('account email verified and membership activated', { userId: user.id });
    res.status(200).send(renderEmailVerifiedPage());
  } catch (err) {
    console.error('[Verify Email Error]', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
};

// ─── Resend Verification Email ────────────────────────────────────────────────

const resendVerification = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    verificationLog('resend requested', { email: maskEmail(email) });
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return 200 to avoid leaking which emails are registered
    if (!user || user.isEmailVerified) {
      verificationLog('resend skipped', {
        email: maskEmail(email),
        reason: !user ? 'account-not-found' : 'already-verified',
      });
      return res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
    }

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    verificationLog('resend token generated', {
      userId: user.id,
      email: maskEmail(email),
      tokenId: tokenFingerprint(emailVerifyToken),
      expiresAt: emailVerifyExpires.toISOString(),
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifyToken, emailVerifyExpires },
    });

    try {
      verificationLog('sending resend verification email', {
        userId: user.id,
        email: maskEmail(email),
        tokenId: tokenFingerprint(emailVerifyToken),
      });
      await sendVerificationEmail(email, emailVerifyToken);
    } catch (mailErr) {
      console.error('[Email Verification] resend email failed', {
        userId: user.id,
        email: maskEmail(email),
        tokenId: tokenFingerprint(emailVerifyToken),
        code: mailErr.code || mailErr.name,
        message: mailErr.message,
        responseCode: mailErr.responseCode,
      });
      // Keep any previously-issued link usable if the replacement email could
      // not be handed to the provider.
      await prisma.user.updateMany({
        where: { id: user.id, emailVerifyToken },
        data: {
          emailVerifyToken: user.emailVerifyToken,
          emailVerifyExpires: user.emailVerifyExpires,
        },
      });
      return res.status(503).json({
        error: 'We could not send the verification email. Please try again shortly.',
        errorCode: mailErr.message?.includes('BACKEND_URL')
          ? 'EMAIL_LINK_CONFIGURATION_ERROR'
          : 'EMAIL_DELIVERY_FAILED',
        requiresEmailVerification: true,
        email,
        emailDeliveryFailed: true,
      });
    }

    verificationLog('resend verification email sent', { userId: user.id, email: maskEmail(email) });
    res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
  } catch (err) {
    console.error('[Resend Verification Error]', err);
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
};

const verificationStatus = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { isEmailVerified: true },
    });

    return res.json({
      verified: Boolean(user?.isEmailVerified),
      message: user?.isEmailVerified
        ? 'Your email has been verified. You can now log in.'
        : 'Your email is not verified yet. Open the verification link sent to your inbox.',
    });
  } catch (err) {
    console.error('[Verification Status Error]', err);
    return res.status(500).json({ error: 'Unable to check verification status.' });
  }
};

// Local development helper: reset an existing test account back to the
// unverified state without creating another email account. It is disabled in
// production and requires a separate development-only secret.
const resetVerificationForDevelopment = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Route not found' });
  }

  const configuredKey = process.env.DEV_TEST_API_KEY;
  if (!configuredKey || req.get('x-dev-test-key') !== configuredKey) {
    return res.status(403).json({ error: 'A valid development test key is required.' });
  }

  const email = req.body.email?.trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Test account not found.' });

    const emailVerifyToken = crypto.randomBytes(32).toString('hex');
    const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { isEmailVerified: false, emailVerifyToken, emailVerifyExpires },
      }),
      prisma.membership.update({ where: { userId: user.id }, data: { status: 'INACTIVE' } }),
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    verificationLog('development verification reset completed', {
      userId: user.id,
      email: maskEmail(email),
      tokenId: tokenFingerprint(emailVerifyToken),
    });

    await sendVerificationEmail(email, emailVerifyToken);
    return res.json({ message: 'Test account reset. A fresh verification email has been sent.' });
  } catch (err) {
    console.error('[Email Verification] development reset failed', {
      email: maskEmail(email),
      code: err.code || err.name,
      message: err.message,
    });
    return res.status(500).json({ error: 'Unable to reset the test account.' });
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

  const { email, password, firstName, lastName } = req.body;
  const phone = normalizeOptionalPhone(req.body.phone);

  try {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
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
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(' ') : String(err.meta?.target || '');
      return res.status(409).json({ error: target.includes('phone') ? 'Phone number is already registered' : 'Email is already registered' });
    }
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
        expiresAt: getRefreshTokenExpiresAt(user.role),
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
        // Birthday credits are fixed at one Regular-table hour of value.
        const birthdayCredits = 120;
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
              description: 'Birthday reward: 120 credits (equivalent to one free hour on a Regular table).',
            },
          }),
          prisma.creditTransaction.create({
            data: {
              userId: user.id,
              type: 'LOYALTY_REWARD',
              amount: birthdayCredits,
              balanceBefore: user.membership.creditBalance,
              balanceAfter: user.membership.creditBalance + birthdayCredits,
              description: 'Birthday reward - 120 credits (one Regular-table hour equivalent)',
            },
          }),
          prisma.notification.create({
            data: {
              userId: user.id,
              type: 'BIRTHDAY_REWARD',
              title: 'Happy Birthday! 🎉',
              message: "You've received 120 birthday credits — equivalent to 1 free hour on a Regular table. Enjoy your game!",
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
        expiresAt: getRefreshTokenExpiresAt(user.role),
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
      include: { membership: true, gamifiedProfile: true, championTitles: { orderBy: { earnedAt: 'desc' } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, emailVerifyToken, emailVerifyExpires, ...safeUser } = user;
    res.json({ ...safeUser, gamifiedProfile: presentGamifiedProfile(user.gamifiedProfile, user.championTitles.length > 0) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// ─── Forgot / Reset Password (Public) ─────────────────────────────────────────

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    // Always 200 to avoid leaking which emails exist.
    if (!user || !user.isEmailVerified) {
      return res.json({ message: 'If that email exists and is verified, a reset link has been sent.' });
    }

    const secret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_PASSWORD_RESET_EXPIRES_IN || '1h';
    const token = jwt.sign({ userId: user.id, purpose: 'PASSWORD_RESET' }, secret, { expiresIn });

    sendPasswordResetEmail(user.email, token).catch((err) =>
      console.error('[Password Reset Email Error]', err?.message || err)
    );

    return res.json({ message: 'If that email exists and is verified, a reset link has been sent.' });
  } catch (err) {
    console.error('[Forgot Password Error]', err);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
};

const renderResetPasswordHtml = ({ token, error }) => {
  const safeError = error ? String(error) : '';
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Reset Password</title>
      </head>
      <body style="font-family: Arial, sans-serif; background: #0A0E1A; color: #fff; padding: 24px;">
        <div style="max-width: 420px; margin: 0 auto; background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 18px;">
          <h2 style="margin: 0 0 10px;">Reset Password</h2>
          <p style="margin: 0 0 14px; color: #cbd5e1;">Enter a new password for your account.</p>
          <p style="margin: 0 0 14px; color: #cbd5e1; font-size: 13px;">Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.</p>
          ${safeError ? `<div style="background:#7f1d1d; border:1px solid #ef4444; padding:10px; border-radius:10px; margin:0 0 12px;">${safeError}</div>` : ''}
          <form method="POST" action="/api/auth/reset-password" id="reset-password-form" style="display:flex; flex-direction:column; gap:10px;">
            <input type="hidden" name="token" value="${token || ''}" />
            <label style="font-size: 13px; color: #cbd5e1;">New password</label>
            <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="8+ chars, uppercase, lowercase, number, special character"
              style="padding: 12px; border-radius: 10px; border: 1px solid #334155; background:#0b1220; color:#fff;" />
            <label style="font-size: 13px; color: #cbd5e1;">Confirm new password</label>
            <input name="confirmPassword" type="password" required autocomplete="new-password" placeholder="Repeat your new password"
              style="padding: 12px; border-radius: 10px; border: 1px solid #334155; background:#0b1220; color:#fff;" />
            <button type="submit" id="reset-password-submit" style="padding: 12px; border: 0; border-radius: 10px; background: #F6C84C; color: #000; font-weight: 800;">
              Set New Password
            </button>
          </form>
        </div>
        <script src="/api/auth/reset-password-page.js" defer></script>
      </body>
    </html>
  `;
};

const renderResetPasswordSuccessHtml = () => {
  const loginUrl = getMobileLoginUrl();
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Password Updated</title>
      </head>
      <body style="font-family: Arial, sans-serif; background: #0A0E1A; color: #fff; padding: 24px;">
        <main style="max-width: 420px; margin: 0 auto; background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 24px; text-align:center;">
          <div aria-hidden="true" style="margin:0 auto 14px; width:52px; height:52px; line-height:52px; border-radius:50%; background:#064e3b; color:#6ee7b7; font-size:30px; font-weight:800;">✓</div>
          <h1 style="margin: 0 0 10px; font-size:24px;">Password Updated</h1>
          <p style="margin: 0 0 22px; color: #cbd5e1; line-height:1.5;">Your password has been updated successfully. You can now sign in using your new password.</p>
          <a href="${loginUrl}" style="display:block; padding:12px; border-radius:10px; background:#F6C84C; color:#000; font-weight:800; text-decoration:none;">Continue to Login</a>
        </main>
      </body>
    </html>
  `;
};

const resetPasswordPageScript = (_req, res) => {
  res.type('application/javascript').send(`
    (function () {
      var form = document.getElementById('reset-password-form');
      var submitButton = document.getElementById('reset-password-submit');
      if (!form || !submitButton) return;

      form.addEventListener('submit', function (event) {
        if (!window.confirm('Are you sure you want to set this as your new password?')) {
          event.preventDefault();
          return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Updating Password...';
        submitButton.setAttribute('aria-busy', 'true');
      });
    }());
  `);
};

const resetPasswordPage = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    res.status(400).send(renderResetPasswordHtml({ token: '', error: 'Missing reset token.' }));
    return;
  }

  try {
    const secret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(String(token), secret);
    if (decoded?.purpose !== 'PASSWORD_RESET' || !decoded?.userId) {
      return res.status(400).send(renderResetPasswordHtml({ token: '', error: 'Invalid reset token.' }));
    }
    return res.status(200).send(renderResetPasswordHtml({ token: String(token) }));
  } catch {
    return res.status(400).send(renderResetPasswordHtml({ token: '', error: 'Invalid or expired reset token.' }));
  }
};

const resetPassword = async (req, res) => {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (isDevelopment) console.log('[Reset Password] POST_RECEIVED');
  const { token, password, confirmPassword } = req.body;
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  const resetError = (status, message, preserveToken = true) => wantsHtml
    ? res.status(status).send(renderResetPasswordHtml({ token: preserveToken ? String(token || '') : '', error: message }))
    : res.status(status).json({ error: message });
  const resetFailure = (stage, error) => {
    if (isDevelopment) {
      console.warn(`[Reset Password] FAILED_AT: ${stage}`, error ? {
        name: error.name,
        code: error.code,
        message: error.message,
      } : undefined);
    }
  };
  if (isDevelopment) {
    console.log('[Reset Password] BODY_PARSED', {
      contentType: req.headers['content-type'] || 'unknown',
      hasToken: Boolean(token),
      hasPassword: Boolean(password),
      hasConfirmPassword: Boolean(confirmPassword),
    });
  }
  if (!token || !password) {
    resetFailure('REQUEST_VALIDATION');
    return resetError(400, 'Token and password are required.');
  }
  if (isDevelopment) console.log('[Reset Password] TOKEN_FOUND');
  const secret = process.env.JWT_PASSWORD_RESET_SECRET || process.env.JWT_SECRET;
  let decoded;
  try {
    decoded = jwt.verify(String(token), secret);
  } catch (error) {
    resetFailure('TOKEN_VALIDATION', error);
    return resetError(400, 'This password reset link is invalid or has expired.', false);
  }

  if (decoded?.purpose !== 'PASSWORD_RESET' || !decoded?.userId) {
    resetFailure('TOKEN_PURPOSE_VALIDATION');
    return resetError(400, 'This password reset link is invalid or has already been used.', false);
  }
  if (isDevelopment) console.log('[Reset Password] TOKEN_VALID');

  if (confirmPassword !== undefined && password !== confirmPassword) {
    resetFailure('CONFIRMATION_VALIDATION');
    return resetError(400, 'The passwords do not match.');
  }
  if (isDevelopment) console.log('[Reset Password] CONFIRMATION_VALID');

  // Enforce strong password policy (same as registration)
  if (!hasValidPassword(password)) {
    resetFailure('PASSWORD_POLICY_VALIDATION');
    return resetError(400, passwordPolicyMessage);
  }
  if (isDevelopment) console.log('[Reset Password] POLICY_VALID');

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isEmailVerified) {
      resetFailure('USER_VALIDATION');
      return resetError(400, 'This password reset link is invalid or has already been used.', false);
    }
    if (isDevelopment) console.log('[Reset Password] USER_FOUND');
    const issuedAt = Number(decoded.iat || 0) * 1000;
    if (!issuedAt || user.updatedAt.getTime() > issuedAt) {
      resetFailure('TOKEN_REUSE_VALIDATION');
      return resetError(400, 'This password reset link is invalid or has already been used.', false);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    if (isDevelopment) console.log('[Reset Password] PASSWORD_HASHED');

    if (isDevelopment) console.log('[Reset Password] USER_UPDATE_START');
    const [, refreshTokensResult] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      // Invalidate sessions
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);

    if (isDevelopment) {
      console.log('[Reset Password] USER_UPDATED');
      console.log('[Reset Password] REFRESH_TOKENS_REVOKED', { count: refreshTokensResult?.count || 0 });
    }

    if (wantsHtml) {
      if (isDevelopment) console.log('[Reset Password] SUCCESS_RENDERED');
      return res.status(200).send(renderResetPasswordSuccessHtml());
    }

    if (isDevelopment) console.log('[Reset Password] SUCCESS_RESPONSE');
    return res.json({ message: 'Password reset successful' });
  } catch (err) {
    resetFailure('DATABASE_UPDATE', err);
    return resetError(500, 'Could not update password. Please try again.');
  }
};

module.exports = {
  register,
  registerWithDependencies,
  verifyEmail,
  resendVerification,
  verificationStatus,
  resetVerificationForDevelopment,
  createStaff,
  login,
  refresh,
  logout,
  getMe,
  forgotPassword,
  resetPasswordPage,
  resetPasswordPageScript,
  resetPassword,
  registerValidation,
  loginValidation,
  createStaffValidation,
};
