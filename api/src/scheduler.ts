import crypto from 'node:crypto';
import cron, { ScheduledTask } from 'node-cron';
import { PoolClient } from 'pg';
import { pool, withTransaction } from './db';
import { addLocalDays, CENTRE_TIMEZONE, formatCentreDateTime, formatCentreTime, localDateForInstant, localDayWindow } from './time';
import { enqueueDigestEmail } from './scheduler_email';

export const COACH_DIGEST = 'coach_digest';
export const ADMIN_DIGEST = 'admin_digest';

type JobName = typeof COACH_DIGEST | typeof ADMIN_DIGEST;
type JobRun = {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  available_at: Date;
  lease_until: Date | null;
};

const MAX_CATCH_UP_DAYS = 30;
const MAX_JOB_ATTEMPTS = 5;
const LEASE_MINUTES = 5;

export function schedulerEnabled(value = process.env.SCHEDULER_ENABLED): boolean {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`SCHEDULER_ENABLED must be true or false, received ${value}`);
}

function jobReportDate(jobName: JobName, triggerDate: string): string {
  return jobName === COACH_DIGEST ? addLocalDays(triggerDate, 1) : addLocalDays(triggerDate, -1);
}

function jobInitialWatermark(jobName: JobName, activationDay: string): string {
  return jobName === COACH_DIGEST ? activationDay : addLocalDays(activationDay, -1);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

async function materializeCoachDigest(client: PoolClient, reportDate: string): Promise<void> {
  const window = localDayWindow(reportDate);
  const coaches = await client.query<{ id: number; email: string; full_name: string }>(
    "select id, email, full_name from person where kind = 'coach' and active = true order by id"
  );

  for (const coach of coaches.rows) {
    const sessions = await client.query<{
      id: number;
      discipline: string;
      session_type: string;
      starts_at: Date;
      ends_at: Date;
      room_name: string;
      booking_count: number;
    }>(
      `select s.id, s.discipline, s.session_type, s.starts_at, s.ends_at, r.name as room_name,
              count(e.id) filter (where e.person_id <> s.coach_id)::int as booking_count
         from session s
         join room r on r.id = s.room_id
         left join enrolment e on e.session_id = s.id and e.status = 'active'
        where s.status <> 'cancelled'
          and s.starts_at >= $1::timestamptz and s.starts_at < $2::timestamptz
          and (s.coach_id = $3 or exists (
            select 1 from enrolment attended where attended.session_id = s.id
              and attended.person_id = $3 and attended.status = 'active'
          ))
        group by s.id, r.id
        order by s.starts_at, s.id`,
      [window.from, window.to, coach.id]
    );
    if (sessions.rowCount === 0) continue;

    const lines = sessions.rows.map((session) =>
      `- ${formatCentreDateTime(session.starts_at)} - ${formatCentreTime(session.ends_at)}: ${session.discipline} (${session.session_type}), ${session.room_name}, ${session.booking_count} booking(s)`
    );
    await enqueueDigestEmail(
      client,
      `digest:${COACH_DIGEST}:${reportDate}`,
      'digest.coach',
      coach.email,
      `Coach digest for ${reportDate}`,
      `Here is a summary of your sessions for ${reportDate}.

${lines.join('\n')}

If you have any questions, please contact the Atrium team.`
    );
  }
}

async function materializeAdminDigest(client: PoolClient, reportDate: string): Promise<void> {
  const window = localDayWindow(reportDate);
  const admins = await client.query<{ email: string }>(
    "select email from person where kind = 'admin' and active = true order by id"
  );
  if (admins.rowCount === 0) return;

  const sessions = await client.query<{
    id: number;
    discipline: string;
    status: string;
    starts_at: Date;
    ends_at: Date;
    room_name: string;
    coach_name: string;
    enrolment_count: number;
    cancelled_count: number;
    check_in_count: number;
  }>(
    `select s.id, s.discipline, s.status, s.starts_at, s.ends_at, r.name as room_name,
            coach.full_name as coach_name,
            count(distinct e.id)::int as enrolment_count,
            count(distinct e.id) filter (where e.status = 'cancelled')::int as cancelled_count,
            count(ci.id)::int as check_in_count
       from session s
       join room r on r.id = s.room_id
       join person coach on coach.id = s.coach_id
       left join enrolment e on e.session_id = s.id
       left join check_in ci on ci.enrolment_id = e.id
      where s.starts_at >= $1::timestamptz and s.starts_at < $2::timestamptz
      group by s.id, r.id, coach.id
      order by s.starts_at, s.id`,
    [window.from, window.to]
  );

  const lines = sessions.rows.length === 0
    ? ['No sessions.']
    : sessions.rows.map((session) =>
      `- ${formatCentreDateTime(session.starts_at)}: ${session.discipline}, ${session.status}, ${session.room_name}, coach ${session.coach_name}, ${session.enrolment_count} enrolment(s), ${session.cancelled_count} cancelled, ${session.check_in_count} check-in(s)`
    );
  const body = `Here is the daily summary of sessions for ${reportDate}.

${lines.join('\n')}`;
  for (const admin of admins.rows) {
    await enqueueDigestEmail(
      client,
      `digest:${ADMIN_DIGEST}:${reportDate}`,
      'digest.admin',
      admin.email,
      `Administrator digest for ${reportDate}`,
      body
    );
  }
}

async function materializeDigest(client: PoolClient, jobName: JobName, reportDate: string): Promise<void> {
  if (jobName === COACH_DIGEST) await materializeCoachDigest(client, reportDate);
  else await materializeAdminDigest(client, reportDate);
}

type MaterializeDigest = (client: PoolClient, jobName: JobName, reportDate: string) => Promise<void>;

export class Scheduler {
  private task: ScheduledTask | undefined;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly materializer: MaterializeDigest = materializeDigest) {}

  private wake(): void {
    if (this.inFlight || this.stopping) return;
    this.inFlight = this.reconcileAll()
      .catch((error) => console.error('scheduler reconciliation failed', error))
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  async reconcileAll(now = new Date()): Promise<void> {
    const triggerDate = localDateForInstant(now);
    await this.reconcileJob(COACH_DIGEST, triggerDate, now);
    await this.reconcileJob(ADMIN_DIGEST, triggerDate, now);
  }

  async reconcileJob(jobName: JobName, triggerDate: string, now = new Date()): Promise<void> {
    const dueDate = jobReportDate(jobName, triggerDate);
    await withTransaction(async (client) => {
      await client.query("set local statement_timeout = '240s'");
      await client.query(
        `insert into scheduler_state (job_name, activation_day, last_processed_report_date)
         values ($1, $2::date, $3::date)
         on conflict (job_name) do nothing`,
        [jobName, triggerDate, jobInitialWatermark(jobName, triggerDate)]
      );
      const state = await client.query<{ activation_day: string; last_processed_report_date: string }>(
        'select activation_day::text, last_processed_report_date::text from scheduler_state where job_name = $1 for update',
        [jobName]
      );
      const current = state.rows[0];
      const next = addLocalDays(current.last_processed_report_date, 1);
      const first = next > current.activation_day ? next : current.activation_day;
      if (first > dueDate) {
        await client.query('update scheduler_state set last_observed_at = $2, updated_at = $2 where job_name = $1', [jobName, now]);
        return;
      }

      const oldest = addLocalDays(dueDate, -MAX_CATCH_UP_DAYS);
      const windowStart = first > oldest ? first : oldest;
      let skipped = first;
      while (skipped < windowStart) {
        await client.query(
          `insert into job_run (job_name, local_day, status, reason, completed_at)
           values ($1, $2::date, 'skipped', 'catch-up-window-exceeded', now())
           on conflict (job_name, local_day) do nothing`,
          [jobName, skipped]
        );
        const row = await client.query<JobRun>('select id, status, attempts, available_at, lease_until from job_run where job_name = $1 and local_day = $2 for update', [jobName, skipped]);
        if (row.rows[0].status !== 'skipped') return;
        await client.query('update scheduler_state set last_processed_report_date = $2::date, last_observed_at = $3, updated_at = $3 where job_name = $1', [jobName, skipped, now]);
        skipped = addLocalDays(skipped, 1);
      }

      let reportDate = windowStart;
      while (reportDate <= dueDate) {
        await client.query(
          `insert into job_run (job_name, local_day, status, available_at)
           values ($1, $2::date, 'pending', $3)
           on conflict (job_name, local_day) do nothing`,
          [jobName, reportDate, now]
        );
        const runResult = await client.query<JobRun>(
          'select id, status, attempts, available_at, lease_until from job_run where job_name = $1 and local_day = $2 for update skip locked',
          [jobName, reportDate]
        );
        const run = runResult.rows[0];
        if (!run) return;
        if (run.status === 'completed' || run.status === 'skipped') {
          await client.query('update scheduler_state set last_processed_report_date = $2::date, last_observed_at = $3, updated_at = $3 where job_name = $1', [jobName, reportDate, now]);
          reportDate = addLocalDays(reportDate, 1);
          continue;
        }
        if (run.status === 'processing' && run.lease_until && new Date(run.lease_until).getTime() > now.getTime()) return;
        if (run.status === 'processing' && run.attempts >= MAX_JOB_ATTEMPTS) {
          await client.query(
            `update job_run set status = 'failed', lease_until = null, lease_token = null,
                    last_error = coalesce(last_error, 'lease expired after maximum attempts')
               where id = $1`,
            [run.id]
          );
          return;
        }
        if (new Date(run.available_at).getTime() > now.getTime()) return;
        if (run.attempts >= MAX_JOB_ATTEMPTS) return;

        const leaseToken = cryptoRandomUuid();
        await client.query(
          `update job_run set status = 'processing', attempts = attempts + 1,
                 lease_until = $2::timestamptz + interval '${LEASE_MINUTES} minutes', lease_token = $3, last_error = null
           where id = $1`,
          [run.id, now, leaseToken]
        );

        await client.query('savepoint phase5_materialize');
        try {
          await this.materializer(client, jobName, reportDate);
          await client.query(
            `update job_run set status = 'completed', completed_at = $2, lease_until = null, lease_token = null
             where id = $1 and status = 'processing' and lease_token = $3`,
            [run.id, now, leaseToken]
          );
          await client.query('release savepoint phase5_materialize');
        } catch (error) {
          const timeoutCode = (error as { code?: string }).code;
          if (timeoutCode === '57014' || /statement timeout/i.test(errorText(error))) {
            throw error;
          }
          await client.query('rollback to savepoint phase5_materialize');
          const terminal = run.attempts + 1 >= MAX_JOB_ATTEMPTS;
          const availableAt = terminal ? now : new Date(now.getTime() + retryDelay(run.attempts + 1));
          await client.query(
            `update job_run set status = 'failed', available_at = $2,
                   lease_until = null, lease_token = null, last_error = $3
             where id = $1 and status = 'processing' and lease_token = $4`,
            [run.id, availableAt, errorText(error), leaseToken]
          );
          if (terminal) {
            console.error(`scheduler job ${jobName} report ${reportDate} reached the retry limit; manual requeue required`);
          }
          await client.query('release savepoint phase5_materialize');
          return;
        }
        await client.query('update scheduler_state set last_processed_report_date = $2::date, last_observed_at = $3, updated_at = $3 where job_name = $1', [jobName, reportDate, now]);
        reportDate = addLocalDays(reportDate, 1);
      }
    });
  }

  start(): void {
    if (this.task || !schedulerEnabled()) return;
    this.stopping = false;
    this.task = cron.schedule('0 0 * * *', () => {
      this.wake();
    }, { timezone: CENTRE_TIMEZONE });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.task?.stop();
    this.task = undefined;
    if (this.inFlight) await this.inFlight;
  }
}

function cryptoRandomUuid(): string {
  return crypto.randomUUID();
}

function retryDelay(attempt: number): number {
  return [60, 300, 1800, 7200][Math.min(Math.max(attempt - 1, 0), 3)] * 1000;
}

export async function reconcileScheduler(now = new Date()): Promise<void> {
  if (!schedulerEnabled()) return;
  await new Scheduler().reconcileAll(now);
}

export async function requeueSchedulerRun(jobName: JobName, localDay: string): Promise<boolean> {
  const result = await pool.query(
    `update job_run
        set status = 'pending', attempts = 0, available_at = now(), lease_until = null,
            lease_token = null, last_error = null, completed_at = null
      where job_name = $1 and local_day = $2::date and status = 'failed'`,
    [jobName, localDay]
  );
  return result.rowCount === 1;
}
