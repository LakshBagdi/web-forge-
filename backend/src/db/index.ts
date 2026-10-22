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
  const file = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  // Any scan still "running" after a restart was interrupted.
  await pool.query(
    `UPDATE scans SET status='failed', error='Interrupted by server restart', finished_at=now()
     WHERE status IN ('running','queued')`,
  );
}

export async function audit(userId: string | null, action: string, subject?: string, meta: object = {}, ip?: string) {
  try {
    await pool.query('INSERT INTO audit_log(user_id, action, subject, meta, ip) VALUES ($1,$2,$3,$4,$5)', [
      userId, action, subject ?? null, JSON.stringify(meta), ip ?? null,
    ]);
  } catch {
    /* audit must never break a request */
  }
}
