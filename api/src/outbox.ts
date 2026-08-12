import crypto from 'node:crypto';
import { MailSender, createMailer } from './mailer';
import { pool, withTransaction } from './db';
import { errorText, retryDelay } from './retry';

type OutboxRow = {
  id: number;
  event_key: string;
  event_type: string;
  recipient: string;
  subject: string;
  body: string;
  attempt_count: number;
  lease_token: string;
};

const LEASE_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const POLL_MS = 5000;

function isPermanentFailure(error: unknown): boolean {
  const responseCode = Number((error as { responseCode?: number }).responseCode);
  return Number.isInteger(responseCode) && responseCode >= 500 && responseCode < 600;
}

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  private wake(): void {
    if (this.stopping || this.inFlight) return;
    this.inFlight = this.dispatchOnce()
      .then(() => undefined)
      .catch((error) => console.error('outbox dispatch failed', error))
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  constructor(private readonly sender: MailSender = createMailer()) {}

  async dispatchOnce(limit = 20): Promise<number> {
    const rows = await withTransaction(async (client) => {
      const claimed = await client.query<OutboxRow>(
        `with candidates as (
           select id
             from email_outbox
            where (status = 'pending' and available_at <= now())
               or (status = 'processing' and lease_until <= now())
            order by created_at, id
            for update skip locked
            limit $1
         )
         update email_outbox e
            set status = 'processing',
                attempt_count = e.attempt_count + 1,
                lease_until = now() + $3::interval,
                lease_token = $2,
                last_error = null
           from candidates
          where e.id = candidates.id
        returning e.id, e.event_key, e.event_type, e.recipient, e.subject, e.body, e.attempt_count, e.lease_token`,
        [limit, crypto.randomUUID(), `${LEASE_MINUTES} minutes`]
      );
      return claimed.rows;
    });

    for (const row of rows) await this.deliver(row);
    return rows.length;
  }

  private async deliver(row: OutboxRow): Promise<void> {
    try {
      await this.sender.send({
        eventKey: row.event_key,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body
      });
      await pool.query(
        `update email_outbox
            set status = 'sent', sent_at = now(), lease_until = null, lease_token = null,
                body = case when body like '%/setup-password?token=%' then '[redacted]' else body end
          where id = $1 and status = 'processing' and lease_token = $2`,
        [row.id, row.lease_token]
      );
    } catch (error) {
      const terminal = isPermanentFailure(error) || row.attempt_count >= MAX_ATTEMPTS;
      await pool.query(
        `update email_outbox
            set status = $3,
                available_at = case when $3 = 'pending' then now() + ($4 * interval '1 millisecond') else available_at end,
                lease_until = null,
                lease_token = null,
                last_error = $2,
                failed_at = case when $3 = 'failed' then now() else failed_at end,
                body = case when $3 = 'failed' and body like '%/setup-password?token=%' then '[redacted]' else body end
          where id = $1 and status = 'processing' and lease_token = $5`,
        [row.id, errorText(error), terminal ? 'failed' : 'pending', terminal ? 0 : retryDelay(row.attempt_count), row.lease_token]
      );
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      this.wake();
    }, POLL_MS);
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.inFlight) await this.inFlight;
    await this.sender.close();
  }
}
