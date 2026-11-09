/**
 * Mailer — email delivery abstraction.
 *
 * Behaviour:
 *   - SMTP configured (SMTP_HOST set): sends real email via nodemailer.
 *     Throws on delivery failure — callers must handle and never claim success.
 *   - Development / no SMTP: logs the email to console and resolves — clearly
 *     marked as DEV mode so no false success message reaches the user API.
 *   - Production / no SMTP: throws immediately — the API must return an
 *     operational error ("email service not configured") rather than claiming
 *     the email was sent.
 *
 * Never exposes reset tokens in production logs.
 */

import nodemailer from 'nodemailer';
import { env } from '../configuration/env.ts';
import { logger } from './logger.ts';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function isSmtpConfigured(): boolean {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function buildTransport() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

/**
 * Send an email.
 * Throws on any failure — callers must catch and return a truthful error.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!isSmtpConfigured()) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Email service not configured. Contact the system administrator.');
    }
    // Development: log to console, never expose in API response
    logger.info(
      `[DEV MAIL — NOT SENT] To: ${message.to} | Subject: ${message.subject}`,
      'MAILER'
    );
    logger.debug(`[DEV MAIL BODY]\n${message.text}`, 'MAILER');
    return;
  }

  const transport = buildTransport();
  const info = await transport.sendMail({
    from: `"Global Chronicle News" <${env.SMTP_FROM}>`,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  logger.info(`Email delivered — messageId: ${info.messageId}`, 'MAILER');
}

/**
 * Send a password-reset email.
 * In development: logs the link without the raw token in the JSON response.
 * In production with SMTP: sends the email; throws on failure.
 * In production without SMTP: throws with operational error message.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const text =
    `You requested a password reset for your Global Chronicle News account.\n\n` +
    `Click the link below to reset your password. It expires in ${opts.expiresInMinutes} minutes.\n\n` +
    `${opts.resetUrl}\n\n` +
    `If you did not request this, ignore this email. Your password will not change.\n\n` +
    `— Global Chronicle News`;

  const html =
    `<p>You requested a password reset for your <strong>Global Chronicle News</strong> account.</p>` +
    `<p>Click the link below to reset your password. It expires in <strong>${opts.expiresInMinutes} minutes</strong>.</p>` +
    `<p><a href="${opts.resetUrl}">${opts.resetUrl}</a></p>` +
    `<p>If you did not request this, ignore this email.</p>`;

  await sendMail({ to: opts.to, subject: 'Reset your Global Chronicle News password', text, html });
}
