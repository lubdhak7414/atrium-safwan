export function webBaseUrl(): string {
  return process.env.WEB_BASE_URL || 'http://localhost:3000';
}
