import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

process.env.NEXT_PUBLIC_API_BASE_URL ||= process.env.API_BASE_URL || 'http://localhost:4000';
process.env.NEXT_PUBLIC_CENTRE_TIMEZONE ||= process.env.CENTRE_TIMEZONE || 'America/New_York';

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
