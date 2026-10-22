// Shared helpers for scripts/setup.mjs and scripts/dev.mjs (no dependencies).
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const c = { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` };

export function readEnv() {
  const env = {};
  const file = path.join(root, 'backend', '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env || ['DATABASE_URL', 'REDIS_URL', 'PORT'].includes(k))) };
}

export const databaseUrl = () => readEnv().DATABASE_URL || 'postgres://vs:vs@localhost:5432/flowforge';
export const redisUrl = () => readEnv().REDIS_URL || 'redis://localhost:6379';
export const backendPort = () => Number(readEnv().PORT || 4000);

/** true when something accepts connections on host:port */
export function portOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export function hostPort(url, fallbackPort) {
  try { const u = new URL(url); return { host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname, port: Number(u.port) || fallbackPort }; }
  catch { return { host: '127.0.0.1', port: fallbackPort }; }
}

export const SERVICE_HELP = {
  linux: { pg: 'sudo service postgresql start', redis: 'sudo service redis-server start' },
  darwin: { pg: 'brew services start postgresql', redis: 'brew services start redis' },
  win32: { pg: 'Start the "postgresql" service (or run this inside WSL)', redis: 'Run this project inside WSL and: sudo service redis-server start' },
};
export const help = () => SERVICE_HELP[process.platform] || SERVICE_HELP.linux;

/** Try a real database login and explain, in plain words, what to do if it fails. Returns true when it works. */
export async function checkDatabase() {
  const url = databaseUrl();
  const { host, port } = hostPort(url, 5432);
  if (!(await portOpen(port, host))) {
    console.log(c.red(`✗ Postgres is not running (nothing listening on ${host}:${port}).`));
    console.log(`  Start it:  ${c.bold(help().pg)}`);
    return false;
  }
  let Client;
  try { Client = createRequire(path.join(root, 'backend', 'package.json'))('pg').Client; }
  catch { console.log(c.yellow('! Could not test the database login yet (run setup first so packages are installed).')); return true; }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    await client.query('select 1');
    console.log(c.green('✓ Postgres is running and the login works.'));
    return true;
  } catch (e) {
    const u = (() => { try { return new URL(url); } catch { return null; } })();
    const user = u?.username || 'vs', pass = decodeURIComponent(u?.password || 'vs'), db = (u?.pathname || '/flowforge').slice(1);
    if (e.code === '28P01' || e.code === '28000') {
      console.log(c.red(`✗ Postgres is running but refused the login for user "${user}".`));
      console.log('  Fix it once (copy-paste all three lines; an "already exists" message on a line is fine):');
      console.log(c.bold(`    sudo -u postgres psql -c "CREATE USER ${user} WITH PASSWORD '${pass}' SUPERUSER;"`));
      console.log(c.bold(`    sudo -u postgres psql -c "ALTER USER ${user} WITH PASSWORD '${pass}' SUPERUSER;"`));
      console.log(c.bold(`    sudo -u postgres psql -c "CREATE DATABASE ${db} OWNER ${user};"`));
    } else if (e.code === '3D000') {
      console.log(c.red(`✗ The database "${db}" does not exist yet.`));
      console.log(c.bold(`    sudo -u postgres psql -c "CREATE DATABASE ${db} OWNER ${user};"`));
    } else {
      console.log(c.red(`✗ Could not log in to Postgres: ${e.message}`));
    }
    return false;
  } finally { try { await client.end(); } catch { /* ignore */ } }
}

export async function checkRedis() {
  const { host, port } = hostPort(redisUrl(), 6379);
  if (await portOpen(port, host)) { console.log(c.green('✓ Redis is running.')); return true; }
  console.log(c.red(`✗ Redis is not running (nothing listening on ${host}:${port}).`));
  console.log(`  Start it:  ${c.bold(help().redis)}`);
  return false;
}
