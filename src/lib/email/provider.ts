import "server-only";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Default when no provider is configured: logs instead of sending. */
class LogEmailProvider implements EmailProvider {
  readonly name = "log";
  async send(message: EmailMessage) {
    logger.info("Email (not sent — no EMAIL_PROVIDER configured)", {
      to: message.to,
      subject: message.subject,
    });
  }
}

class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string, private from: string) {}
  async send(m: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html, reply_to: m.replyTo }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}

class PostmarkEmailProvider implements EmailProvider {
  readonly name = "postmark";
  constructor(private token: string, private from: string) {}
  async send(m: EmailMessage) {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": this.token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        From: this.from,
        To: Array.isArray(m.to) ? m.to.join(",") : m.to,
        Subject: m.subject,
        TextBody: m.text,
        HtmlBody: m.html,
        ReplyTo: m.replyTo,
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark responded ${res.status}: ${await res.text()}`);
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const from = process.env.EMAIL_FROM ?? "Wild Mountain Woodworks <hello@example.com>";
  switch (process.env.EMAIL_PROVIDER) {
    case "resend":
      if (process.env.RESEND_API_KEY) return (provider = new ResendEmailProvider(process.env.RESEND_API_KEY, from));
      break;
    case "postmark":
      if (process.env.POSTMARK_SERVER_TOKEN) return (provider = new PostmarkEmailProvider(process.env.POSTMARK_SERVER_TOKEN, from));
      break;
  }
  return (provider = new LogEmailProvider());
}

/** Send without ever throwing — submissions are already safely stored. */
export async function sendEmailSafely(message: EmailMessage) {
  try {
    await getEmailProvider().send(message);
  } catch (error) {
    logger.error("Email delivery failed", { error, subject: message.subject });
  }
}
