import nodemailer from "nodemailer";

// Outgoing email through a Gmail account. All three settings come from `.env`:
//   SMTP_USER      the Gmail address that sends
//   SMTP_PASS      a Gmail "app password" for it (never the normal password)
//   SUPPORT_EMAIL  where support tickets are delivered
// With any of them missing, nothing is sent and the caller is told so.
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
export const supportEmail = process.env.SUPPORT_EMAIL;

const transport =
  user && pass
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
        connectionTimeout: 8000,
        socketTimeout: 8000,
      })
    : null;

/** Sends a plain-text email. Returns false, and never throws, when it could not be sent. */
export async function sendMail(mail: { to: string | undefined; subject: string; text: string; replyTo?: string }): Promise<boolean> {
  if (!transport || !mail.to) return false;
  try {
    await transport.sendMail({
      from: `"KenRoute" <${user}>`,
      to: mail.to,
      // One line only: a line break here could add extra mail headers.
      subject: mail.subject.replace(/[\r\n]+/g, " ").slice(0, 150),
      text: mail.text,
      ...(mail.replyTo && { replyTo: mail.replyTo }),
    });
    return true;
  } catch (err) {
    console.error("email not sent:", err instanceof Error ? err.message : err);
    return false;
  }
}
