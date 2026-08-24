import nodemailer from "nodemailer";
import { env } from "../config/env";

function createTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASS must be set to send emails.");
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: "Reset your OmniAI password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:22px;font-weight:700;margin-bottom:8px">Reset your password</h2>
        <p style="color:#555;margin-bottom:24px">
          We received a request to reset the password for your OmniAI account.
          Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
        </p>
        <a
          href="${resetUrl}"
          style="display:inline-block;background:#0d0d0d;color:#fff;text-decoration:none;
                 padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px"
        >
          Reset Password
        </a>
        <p style="color:#aaa;font-size:13px;margin-top:24px">
          If you didn't request this, you can safely ignore this email.
          Your password won't change until you click the link above.
        </p>
        <p style="color:#ccc;font-size:12px;margin-top:8px">
          Or copy this link: <a href="${resetUrl}" style="color:#555">${resetUrl}</a>
        </p>
      </div>
    `,
    text: `Reset your OmniAI password\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  });
}
