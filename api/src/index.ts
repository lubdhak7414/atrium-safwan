import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { issueSetupToken, login, logout, me, redeemSetupToken, requireSession, sessionSecret } from './auth';
import sessionRoutes from './routes/sessions';
import roomRoutes from './routes/rooms';
import peopleRoutes from './routes/people';

export function createApp(): express.Express {
  sessionSecret();
  const app = express();

  app.use(
    cors({
      origin: process.env.WEB_BASE_URL || 'http://localhost:3000',
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.post('/api/login', login);
  app.post('/api/logout', logout);
  app.get('/api/me', requireSession, me);
  app.post('/api/dev/setup-token', issueSetupToken);
  app.post('/api/dev/setup-password', redeemSetupToken);

  app.use('/api/sessions', sessionRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/people', peopleRoutes);

  return app;
}

export function bootstrap(): void {
  const app = createApp();
  const port = Number(process.env.API_PORT) || 4000;
  app.listen(port, () => {
    console.log(`api listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  bootstrap();
}
