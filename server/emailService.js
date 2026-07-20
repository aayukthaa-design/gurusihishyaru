import nodemailer from 'nodemailer';

let cachedTransporter = null;

// Configured entirely via environment variables (server/.env) — never
// hardcoded, never stored in the database, never committed to the repo.
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.BREVO_SMTP_HOST;
  const port = Number(process.env.BREVO_SMTP_PORT || 587);
  const login = process.env.BREVO_SMTP_LOGIN;
  const password = process.env.BREVO_SMTP_PASSWORD;

  if (!host || !login || !password) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: false, // Brevo's 587 port uses STARTTLS, not implicit TLS
    auth: { user: login, pass: password },
  });
  return cachedTransporter;
}

export function isEmailConfigured() {
  return Boolean(process.env.BREVO_SMTP_HOST && process.env.BREVO_SMTP_LOGIN && process.env.BREVO_SMTP_PASSWORD);
}

export async function sendPasswordResetOtpEmail(toEmail, toName, code) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('Email sending is not configured (BREVO_SMTP_* env vars missing) — password reset OTP was not sent.');
    return { success: false, error: 'Email is not configured on the server.' };
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@example.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Guru Shishyaru Tutorials';

  try {
    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: toEmail,
      subject: `${code} is your password reset code`,
      text: `Hi ${toName || ''},\n\nYour password reset code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.\n\n${senderName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #15803D;">${senderName}</h2>
          <p>Hi ${toName || ''},</p>
          <p>Your password reset code is:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
          <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
    return { success: true };
  } catch (err) {
    console.error('Failed to send password reset email:', err);
    return { success: false, error: 'Failed to send email.' };
  }
}
