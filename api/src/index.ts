import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { issueSetupToken, login, logout, me, redeemSetupToken, requireSession, sessionSecret, setupPasswordInfo } from './auth';
import sessionRoutes from './routes/sessions';
import roomRoutes from './routes/rooms';
import peopleRoutes from './routes/people';
import enrolmentRoutes from './routes/enrolments';
import assistantRoutes from './routes/assistant';
import signupRoutes from './routes/signup';
import http from 'node:http';
import { pool } from './db';
import { OutboxDispatcher } from './outbox';
import { Scheduler, schedulerEnabled } from './scheduler';

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 10000);
    server.close(() => {
      clearTimeout(timeout);
      finish();
    });
  });
}

export function createApp(): express.Express {
  sessionSecret();
  const app = express();

  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy !== '' && !/^\d+$/.test(trustProxy)) {
    throw new Error('TRUST_PROXY must be empty or a non-negative integer hop count (e.g. 1 behind a single reverse proxy)');
  }
  app.set('trust proxy', trustProxy ? Number(trustProxy) : false);
  app.use(
    cors({
      origin: process.env.WEB_BASE_URL || 'http://localhost:3000',
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
      }
    });
    next();
  });

  app.post('/api/login', login);
  app.post('/api/logout', logout);
  app.get('/api/me', requireSession, me);
  app.use('/api/signup', signupRoutes);
  app.post('/api/dev/setup-token', issueSetupToken);
  app.get('/api/dev/setup-password', setupPasswordInfo);
  app.post('/api/dev/setup-password', redeemSetupToken);

  app.use('/api/sessions', sessionRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/people', peopleRoutes);
  app.use('/api/enrolments', enrolmentRoutes);
  app.use('/api/assistant', assistantRoutes);

  return app;
}

export async function bootstrap(): Promise<() => Promise<void>> {
  const app = createApp();
  const port = Number(process.env.API_PORT) || 4000;
  const server = await new Promise<http.Server>((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });
  const scheduler = new Scheduler();
  let dispatcher: OutboxDispatcher | undefined;
  let stopping = false;
  let onSigint: (() => void) | undefined;
  let onSigterm: (() => void) | undefined;

  try {
    dispatcher = new OutboxDispatcher();
    if (schedulerEnabled()) await scheduler.reconcileAll();
    scheduler.start();
    dispatcher.start();
  } catch (error) {
    await closeServer(server);
    if (dispatcher) await dispatcher.stop().catch(() => {});
    await pool.end();
    throw error;
  }
  const activeDispatcher = dispatcher;

  console.log(`api listening on http://localhost:${port}`);
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (onSigint) process.removeListener('SIGINT', onSigint);
    if (onSigterm) process.removeListener('SIGTERM', onSigterm);
    const schedulerStopping = scheduler.stop();
    const dispatcherStopping = activeDispatcher.stop();
    await closeServer(server);
    await schedulerStopping;
    await dispatcherStopping;
    await pool.end();
  };
  onSigint = () => void shutdown().catch((error) => console.error('shutdown failed', error));
  onSigterm = () => void shutdown().catch((error) => console.error('shutdown failed', error));
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  return shutdown;
}

if (require.main === module) {
  void bootstrap().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
