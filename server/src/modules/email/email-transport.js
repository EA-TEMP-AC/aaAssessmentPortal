import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

/**
 * SMTP transport. Credentials stay in the nodemailer closure and are never logged.
 * Tests pass their own object with `send()` and do not use this factory.
 */
export function smtpIsConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

export function createSmtpTransport(smtp) {
  const options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
  };
  if (smtp.user) {
    options.auth = { user: smtp.user, pass: smtp.password ?? "" };
  }

  const transporter = nodemailer.createTransport(options);

  return {
    async send({ to, subject, text }) {
      await transporter.sendMail({
        from: smtp.from,
        to,
        subject,
        text,
      });
    },
  };
}

export function createUnconfiguredTransport() {
  return {
    async send() {
      const err = new Error("SMTP is not configured");
      err.code = "SMTP_NOT_CONFIGURED";
      throw err;
    },
  };
}

export function createDefaultTransport() {
  if (!smtpIsConfigured()) return createUnconfiguredTransport();
  return createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  });
}
