const nodemailer = require('nodemailer');

const SENDGRID_MAIL_URL = 'https://api.sendgrid.com/v3/mail/send';
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
    this.code = 'MAIL_NOT_CONFIGURED';
  }
}

const getSendGridConfig = () => {
  const apiKey = String(process.env.SENDGRID_API_KEY || '').trim();
  const from = String(process.env.SENDGRID_FROM || '').trim();
  if (!apiKey || !from) return null;
  return {
    apiKey,
    from,
    fromName: String(process.env.SENDGRID_FROM_NAME || 'Saturday Nights Billiard').trim(),
  };
};

const sendWithSendGrid = async ({ config, to, subject, text, html }) => {
  const content = [];
  if (text) content.push({ type: 'text/plain', value: text });
  if (html) content.push({ type: 'text/html', value: html });
  if (!content.length) throw new Error('Email content is empty.');

  const response = await fetch(SENDGRID_MAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.from, name: config.fromName },
      subject,
      content,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.errors?.map((item) => item.message).filter(Boolean).join('; ')
      || `SendGrid rejected the request with HTTP ${response.status}.`;
    const error = new Error(message);
    error.code = 'SENDGRID_REQUEST_FAILED';
    error.responseCode = response.status;
    throw error;
  }

  return {
    messageId: response.headers.get('x-message-id'),
    accepted: [to],
    response: `SendGrid HTTP ${response.status}`,
  };
};

const createTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = isTruthy(process.env.SMTP_SECURE);
  if (host) return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
};

const sendMailSafe = async ({ to, subject, text, html }) => {
  const sendGridConfig = getSendGridConfig();
  const transporter = createTransporter();
  const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!sendGridConfig && (!transporter || !smtpFrom)) {
    throw new MailConfigurationError(
      'Email delivery is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM, or configure SMTP for local development.'
    );
  }

  mailLog('send started', {
    to: maskEmail(to),
    subject,
    provider: sendGridConfig ? 'sendgrid' : 'smtp',
  });

  try {
    const info = sendGridConfig
      ? await sendWithSendGrid({ config: sendGridConfig, to, subject, text, html })
      : await transporter.sendMail({ from: smtpFrom, to, subject, text, html });

    if (info.rejected?.length) {
      const error = new Error('Email provider rejected the recipient.');
      error.code = 'MAIL_RECIPIENT_REJECTED';
      throw error;
    }

    mailLog('send accepted by provider', {
      to: maskEmail(to),
      provider: sendGridConfig ? 'sendgrid' : 'smtp',
      messageId: info.messageId,
      accepted: info.accepted?.length || 0,
      response: info.response,
    });
    return info;
  } catch (error) {
    console.error('[Mail] send failed', {
      to: maskEmail(to),
      provider: sendGridConfig ? 'sendgrid' : 'smtp',
      code: error.code || error.name,
      message: error.message,
      responseCode: error.responseCode,
      command: error.command,
    });
    throw error;
  }
};

const verifyMailConfiguration = async () => {
  const sendGridConfig = getSendGridConfig();
  if (sendGridConfig) {
    mailLog('SendGrid HTTPS API configured', { from: maskEmail(sendGridConfig.from) });
    return;
  }

  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!transporter || !from) {
    throw new MailConfigurationError(
      'Email delivery is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM, or configure SMTP for local development.'
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
