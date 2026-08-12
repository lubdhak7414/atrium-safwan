import http from 'node:http';
import { createApp } from '../../src/index';

export async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected a TCP server');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

export async function login(baseUrl: string, account: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password })
  });
  if (response.status !== 200) throw new Error(`login failed (${response.status})`);
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('login did not set a cookie');
  return cookie.split(';')[0];
}

export async function request(baseUrl: string, path: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
