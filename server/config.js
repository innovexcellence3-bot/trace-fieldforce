/* Konfigurasi server: dibaca dari .env di root project (lihat .env.example).
   Sengaja tanpa library dotenv: format KEY=VALUE sederhana, baris # = komentar. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = join(ROOT, 'data', 'cache');
export const DIST_DIR = join(ROOT, 'frontend', 'dist');
export const SQL_FILE = join(ROOT, 'server', 'sql', 'visit_verification.sql');

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/* Prioritas: environment variable > .env > .env.example (default bawaan). */
const fileEnv = { ...loadEnvFile(join(ROOT, '.env.example')), ...loadEnvFile(join(ROOT, '.env')) };
const env = (key, fallback = '') => process.env[key] || fileEnv[key] || fallback;

export const config = {
  port: Number(env('TRACE_PORT', '8020')) || 8020,
  host: env('TRACE_HOST', '127.0.0.1'),
  openBrowser: env('TRACE_OPEN_BROWSER') === '1',
  snowflake: {
    account: env('SNOWFLAKE_ACCOUNT'),
    host: env('SNOWFLAKE_HOST'),
    user: env('SNOWFLAKE_USER'),
    authenticator: env('SNOWFLAKE_AUTHENTICATOR', 'externalbrowser'),
    database: env('SNOWFLAKE_DATABASE', 'DB_ID_PRD'),
    warehouse: env('SNOWFLAKE_WAREHOUSE'),
    role: env('SNOWFLAKE_ROLE'),
  },
};
