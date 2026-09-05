const nodemailer = require('nodemailer');

const isTruthy = (value) => String(value || '').toLowerCase() === 'true';
const maskEmail = (email) => {
  const [local, domain] = String(email || '').split('@');
  return domain ? `${local.slice(0, 2)}***@${domain}` : 'unknown-recipient';
};
const mailLog = (event, details = {}) => console.info(`[Mail] ${event}`, details);

class MailConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailConfigurationError';
    this.code = 'SMTP_NOT_CONFIGURED';
  }
}

const createTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = isTruthy(process.env.SMTP_SECURE);

  if (host) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  // Default to Gmail for quick testing
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
};

const sendMailSafe = async ({ to, subject, text, html }) => {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!transporter || !from) {
    // Do not pretend delivery succeeded. Callers need this error so they do not
    // activate or report a verification flow that the user cannot complete.
    throw new MailConfigurationError(
      'Email delivery is not configured. Set SMTP_USER and SMTP_PASS (and optionally SMTP_HOST, SMTP_PORT, SMTP_SECURE, and SMTP_FROM).'
    );
  }

  mailLog('send started', {
    to: maskEmail(to),
    subject,
    host: process.env.SMTP_HOST || 'gmail service',
    port: Number(process.env.SMTP_PORT || 587),
  });

  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    if (info.rejected?.length) {
      const error = new Error('SMTP rejected the recipient.');
      error.code = 'MAIL_RECIPIENT_REJECTED';
      throw error;
    }
    mailLog('send accepted by provider', {
      to: maskEmail(to),
      messageId: info.messageId,
      accepted: info.accepted?.length || 0,
      response: info.response,
    });
    return info;
  } catch (error) {
    console.error('[Mail] send failed', {
      to: maskEmail(to),
      code: error.code || error.name,
      message: error.message,
      responseCode: error.responseCode,
      command: error.command,
    });
    throw error;
  }
};

const verifyMailConfiguration = async () => {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!transporter || !from) {
    throw new MailConfigurationError(
      'Email delivery is not configured. Set SMTP_USER and SMTP_PASS (and optionally SMTP_HOST, SMTP_PORT, SMTP_SECURE, and SMTP_FROM).'
    );
  }

  mailLog('SMTP verification started', {
    host: process.env.SMTP_HOST || 'gmail service',
    port: Number(process.env.SMTP_PORT || 587),
    secure: isTruthy(process.env.SMTP_SECURE),
  });
  await transporter.verify();
  mailLog('SMTP verification succeeded');
};

module.exports = { sendMailSafe, verifyMailConfiguration, MailConfigurationError };
