import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { OutboxDispatcher } from '../src/outbox';
import { MailMessage, MailSender } from '../src/mailer';
import { requeueSchedulerRun, Scheduler } from '../src/scheduler';
import { pool, query } from '../src/db';
import { assertIntegrationDatabaseConfigured, resetDatabase } from './helpers/database';

assertIntegrationDatabaseConfigured();

class FakeSender implements MailSender {
  readonly messages: MailMessage[] = [];
  error: unknown;
  onSend?: () => Promise<void>;

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    if (this.onSend) await this.onSend();
    if (this.error) throw this.error;
  }

  async close(): Promise<void> {}
}

describe('phase 5 email and scheduler integration', () => {
  before(async () => {
    await resetDatabase();
  });

  after(async () => {
    await pool.end();
  });

  test('outbox sends after claim, redacts setup URLs, and fences stale workers', async () => {
    const sender = new FakeSender();
    const eventKey = `setup:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox (event_key, event_type, recipient, subject, body)
       values ($1, 'password.setup', 'person@example.test', 'Set up', 'https://example.test/api/dev/setup-password?token=secret')`,
      [eventKey]
    );

    const dispatcher = new OutboxDispatcher(sender);
    assert.equal(await dispatcher.dispatchOnce(), 1);
    const sent = await query<{ status: string; body: string; attempt_count: number }>(
      'select status, body, attempt_count from email_outbox where event_key = $1',
      [eventKey]
    );
    assert.deepEqual(sent[0], { status: 'sent', body: '[redacted]', attempt_count: 1 });

    const staleKey = `stale:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox (event_key, event_type, recipient, subject, body)
       values ($1, 'test', 'stale@example.test', 'Test', 'body')`,
      [staleKey]
    );
    sender.onSend = async () => {
      await query(
        `update email_outbox
            set lease_token = $2, lease_until = now() + interval '5 minutes'
          where event_key = $1`,
        [staleKey, crypto.randomUUID()]
      );
    };
    assert.equal(await dispatcher.dispatchOnce(), 1);
    const stale = await query<{ status: string }>('select status from email_outbox where event_key = $1', [staleKey]);
    assert.equal(stale[0].status, 'processing');
  });

  test('transient SMTP failures retry with a future availability time', async () => {
    const sender = new FakeSender();
    sender.error = Object.assign(new Error('connection refused'), { responseCode: 450 });
    const eventKey = `retry:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox (event_key, event_type, recipient, subject, body)
       values ($1, 'test', 'retry@example.test', 'Test', 'body')`,
      [eventKey]
    );
    const before = Date.now();
    const dispatcher = new OutboxDispatcher(sender);
    assert.equal(await dispatcher.dispatchOnce(), 1);
    const retry = await query<{ status: string; attempt_count: number; available_at: Date; last_error: string }>(
      'select status, attempt_count, available_at, last_error from email_outbox where event_key = $1',
      [eventKey]
    );
    assert.equal(retry[0].status, 'pending');
    assert.equal(retry[0].attempt_count, 1);
    assert.ok(new Date(retry[0].available_at).getTime() >= before + 59000);
    assert.equal(retry[0].last_error, 'connection refused');
  });

  test('permanent SMTP failures and expired leases are handled distinctly', async () => {
    const terminalSender = new FakeSender();
    terminalSender.error = Object.assign(new Error('mailbox rejected'), { responseCode: 550 });
    const terminalKey = `terminal:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox (event_key, event_type, recipient, subject, body)
       values ($1, 'test', 'terminal@example.test', 'Test', 'body')`,
      [terminalKey]
    );
    assert.equal(await new OutboxDispatcher(terminalSender).dispatchOnce(), 1);
    const terminal = await query<{ status: string; failed_at: Date | null }>(
      'select status, failed_at from email_outbox where event_key = $1',
      [terminalKey]
    );
    assert.equal(terminal[0].status, 'failed');
    assert.ok(terminal[0].failed_at);

    const expiredKey = `expired:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox
         (event_key, event_type, recipient, subject, body, status, attempt_count, available_at, lease_until, lease_token)
       values ($1, 'test', 'expired@example.test', 'Test', 'body', 'processing', 1, now(), now() - interval '1 minute', $2)`,
      [expiredKey, crypto.randomUUID()]
    );
    const expiredSender = new FakeSender();
    assert.equal(await new OutboxDispatcher(expiredSender).dispatchOnce(), 1);
    const expired = await query<{ status: string; attempt_count: number }>(
      'select status, attempt_count from email_outbox where event_key = $1',
      [expiredKey]
    );
    assert.deepEqual(expired[0], { status: 'sent', attempt_count: 2 });
  });

  test('the fifth transient outbox attempt becomes failed and redacts setup content', async () => {
    const sender = new FakeSender();
    sender.error = Object.assign(new Error('temporary SMTP outage'), { responseCode: 450 });
    const eventKey = `max-attempts:${crypto.randomUUID()}`;
    await query(
      `insert into email_outbox
         (event_key, event_type, recipient, subject, body, attempt_count)
       values ($1, 'password.setup', 'max@example.test', 'Set up',
               'https://example.test/api/dev/setup-password?token=secret', 4)`,
      [eventKey]
    );
    assert.equal(await new OutboxDispatcher(sender).dispatchOnce(), 1);
    const row = await query<{ status: string; attempt_count: number; body: string; failed_at: Date | null }>(
      'select status, attempt_count, body, failed_at from email_outbox where event_key = $1',
      [eventKey]
    );
    assert.equal(row[0].status, 'failed');
    assert.equal(row[0].attempt_count, 5);
    assert.equal(row[0].body, '[redacted]');
    assert.ok(row[0].failed_at);
  });

  test('scheduler applies first-boot report dates and materializes admin digest rows', async () => {
    const people = await query<{ id: number }>(
      `insert into person (email, password_hash, full_name, kind, credits, active, created_at)
       values ('phase5-admin@example.test', 'unused', 'Phase 5 Admin', 'admin', 0, true, now()),
              ('phase5-coach@example.test', 'unused', 'Phase 5 Coach', 'coach', 0, true, now())
       returning id`
    );
    const room = await query<{ id: number }>(
      "insert into room (name, capacity) values ('Phase 5 Room', 4) returning id"
    );
    await query(
      `insert into session
         (room_id, coach_id, discipline, session_type, status, starts_at, ends_at,
          room_fee_credits, seat_fee_credits, created_at)
       values ($1, $2, 'digest', 'standard', 'completed', '2030-01-01 15:00:00+00',
               '2030-01-01 16:00:00+00', 40, 20, now())`,
      [room[0].id, people[1].id]
    );

    const scheduler = new Scheduler();
    await scheduler.reconcileJob('coach_digest', '2030-01-01', new Date('2030-01-01T05:00:00.000Z'));
    await Promise.all([
      scheduler.reconcileJob('coach_digest', '2030-01-01', new Date('2030-01-01T05:00:00.000Z')),
      scheduler.reconcileJob('coach_digest', '2030-01-01', new Date('2030-01-01T05:00:00.000Z'))
    ]);
    const coachRuns = await query<{ local_day: string; status: string }>(
      "select local_day::text, status from job_run where job_name = 'coach_digest'"
    );
    assert.deepEqual(coachRuns, [{ local_day: '2030-01-02', status: 'completed' }]);

    await scheduler.reconcileJob('admin_digest', '2030-01-01', new Date('2030-01-01T05:00:00.000Z'));
    const firstAdmin = await query<{ count: string }>("select count(*)::text as count from job_run where job_name = 'admin_digest'");
    assert.equal(Number(firstAdmin[0].count), 0);

    await scheduler.reconcileJob('admin_digest', '2030-01-02', new Date('2030-01-02T05:00:00.000Z'));
    const adminRows = await query<{ event_type: string; recipient: string; event_key: string }>(
      "select event_type, recipient, event_key from email_outbox where event_type = 'digest.admin'"
    );
    assert.deepEqual(adminRows, [{
      event_type: 'digest.admin',
      recipient: 'phase5-admin@example.test',
      event_key: 'digest:admin_digest:2030-01-01'
    }]);

    const failedRun = await query<{ id: number }>(
      `insert into job_run (job_name, local_day, status, attempts, available_at, last_error)
       values ('admin_digest', '2030-01-03', 'failed', 5, now(), 'test failure')
       returning id`
    );
    assert.equal(await requeueSchedulerRun('admin_digest', '2030-01-03'), true);
    const requeued = await query<{ status: string; attempts: number }>('select status, attempts from job_run where id = $1', [failedRun[0].id]);
    assert.deepEqual(requeued[0], { status: 'pending', attempts: 0 });
  });

  test('scheduler materialization failures retry with backoff, block the watermark at the retry limit, and recover via requeue', async () => {
    const failing = () => { throw new Error('injected digest failure'); };
    const scheduler = new Scheduler(failing);

    const trigger = '2030-01-05';
    for (const now of [
      new Date('2030-01-05T05:00:00.000Z'),
      new Date('2030-01-05T05:10:00.000Z'),
      new Date('2030-01-05T05:20:00.000Z'),
      new Date('2030-01-05T06:00:00.000Z'),
      new Date('2030-01-05T08:30:00.000Z')
    ]) {
      await scheduler.reconcileJob('coach_digest', trigger, now);
    }

    const failed = await query<{ status: string; attempts: number; last_error: string | null; available_at: Date }>(
      `select status, attempts, last_error, available_at from job_run
        where job_name = 'coach_digest' and local_day = '2030-01-03'`,
    );
    assert.equal(failed[0].status, 'failed');
    assert.equal(failed[0].attempts, 5);
    assert.match(failed[0].last_error ?? '', /injected digest failure/);

    const blocked = await query<{ watermark: string }>(
      "select to_char(last_processed_report_date, 'YYYY-MM-DD') as watermark from scheduler_state where job_name = 'coach_digest'",
    );
    assert.equal(blocked[0].watermark, '2030-01-02');

    await scheduler.reconcileJob('coach_digest', trigger, new Date('2030-01-05T09:00:00.000Z'));
    const stillBlocked = await query<{ attempts: number }>(
      `select attempts from job_run where job_name = 'coach_digest' and local_day = '2030-01-03'`,
    );
    assert.equal(stillBlocked[0].attempts, 5);

    assert.equal(await requeueSchedulerRun('coach_digest', '2030-01-03'), true);
    await new Scheduler().reconcileJob('coach_digest', trigger, new Date('2030-01-05T09:01:00.000Z'));

    const recovered = await query<{ local_day: string; status: string }>(
      `select to_char(local_day, 'YYYY-MM-DD') as local_day, status from job_run
        where job_name = 'coach_digest' and local_day >= '2030-01-03' order by local_day`,
    );
    assert.deepEqual(recovered, [
      { local_day: '2030-01-03', status: 'completed' },
      { local_day: '2030-01-04', status: 'completed' },
      { local_day: '2030-01-05', status: 'completed' },
      { local_day: '2030-01-06', status: 'completed' }
    ]);
    const advanced = await query<{ watermark: string }>(
      "select to_char(last_processed_report_date, 'YYYY-MM-DD') as watermark from scheduler_state where job_name = 'coach_digest'",
    );
    assert.equal(advanced[0].watermark, '2030-01-06');
  });
});
