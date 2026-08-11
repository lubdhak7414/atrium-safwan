import crypto from 'node:crypto';
import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';

export type MailMessage = {
  eventKey: string;
  recipient: string;
  subject: string;
  body: string;
};

export type MailSender = {
  send(message: MailMessage): Promise<void>;
  close(): Promise<void>;
};

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`expected true or false, received ${value}`);
}

export function messageId(eventKey: string, recipient: string): string {
  const digest = crypto.createHash('sha256').update(`${eventKey}\0${recipient}`).digest('hex');
  const domain = process.env.MAIL_MESSAGE_ID_DOMAIN || 'atrium.local';
  return `<atrium-${digest}@${domain}>`;
}

export class NodemailerSender implements MailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(transporter: Transporter, from: string) {
    this.transporter = transporter;
    this.from = from;
  }

  async send(message: MailMessage): Promise<void> {
    const options: SendMailOptions = {
      from: this.from,
      to: message.recipient,
      subject: message.subject,
      text: message.body,
      messageId: messageId(message.eventKey, message.recipient)
    };
    await this.transporter.sendMail(options);
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

export function createMailer(): MailSender {
  const transport = process.env.MAIL_TRANSPORT || 'smtp';
  if (transport !== 'smtp') throw new Error(`unsupported MAIL_TRANSPORT: ${transport}`);

  const port = Number(process.env.SMTP_PORT || 1025);
  if (!Number.isInteger(port) || port <= 0) throw new Error('SMTP_PORT must be a positive integer');
  const secure = parseBoolean(process.env.SMTP_SECURE, false);
  const user = process.env.SMTP_USER || '';
  const password = process.env.SMTP_PASSWORD || '';
  if ((user && !password) || (!user && password)) throw new Error('SMTP_USER and SMTP_PASSWORD must be provided together');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port,
    secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    ...(user && password ? { auth: { user, pass: password } } : {})
  });
  return new NodemailerSender(transporter, process.env.MAIL_FROM || 'no-reply@atrium.local');
}
