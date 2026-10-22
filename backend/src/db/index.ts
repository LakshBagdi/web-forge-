import fs from 'node:fs';
import path from 'node:path';
import { Pool, QueryResultRow } from 'pg';
import { config } from '../config';

const needsSsl = /sslmode=require|neon\.tech|render\.com|supabase/.test(config.databaseUrl);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function migrate() {
  const candidates = [path.join(__dirname, 'schema.sql'), path.join(process.cwd(), 'src/db/schema.sql')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('schema.sql not found');
  await pool.query(fs.readFileSync(file, 'utf8'));
  // Any run left mid-flight by a restart is marked failed so it can be retried cleanly.
  await pool.query(
    `UPDATE runs SET status='failed', error='Interrupted by server restart', finished_at=now()
     WHERE status IN ('running','queued')`,
  );
}
