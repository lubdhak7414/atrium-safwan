import { PoolClient } from 'pg';

export async function enqueueDigestEmail(
  client: PoolClient,
  eventKey: string,
  eventType: string,
  recipient: string,
  subject: string,
  body: string
): Promise<void> {
  await client.query(
    `insert into email_outbox (event_key, event_type, recipient, subject, body)
     values ($1, $2, $3, $4, $5)
     on conflict (event_key, recipient) do nothing`,
    [eventKey, eventType, recipient, subject, body]
  );
}
