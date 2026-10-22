import { one, query } from '../db';
import { encrypt, decrypt, EncBlob } from '../crypto';
import { DecryptedCredential } from '../engine/nodes';

export interface CredentialPublic {
  id: string;
  name: string;
  type: string;
  created_at: string;
}

export async function createCredential(userId: string, name: string, type: string, data: Record<string, string>) {
  const blob = encrypt(JSON.stringify(data));
  return one<CredentialPublic>(
    `INSERT INTO credentials(user_id, name, type, enc) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, name) DO UPDATE SET type=EXCLUDED.type, enc=EXCLUDED.enc
     RETURNING id, name, type, created_at`,
    [userId, name, type, JSON.stringify(blob)],
  );
}

export async function listCredentials(userId: string): Promise<CredentialPublic[]> {
  // Never selects the encrypted blob — secrets never leave the server.
  return query<CredentialPublic>(
    'SELECT id, name, type, created_at FROM credentials WHERE user_id=$1 ORDER BY created_at DESC',
    [userId],
  );
}

export async function deleteCredential(userId: string, id: string) {
  await query('DELETE FROM credentials WHERE id=$1 AND user_id=$2', [id, userId]);
}

/** For the engine only. Decrypts the stored secret at execution time. */
export async function getCredentialDecrypted(id: string): Promise<DecryptedCredential | null> {
  const row = await one<{ type: string; enc: EncBlob }>('SELECT type, enc FROM credentials WHERE id=$1', [id]);
  if (!row) return null;
  try {
    return { type: row.type, data: JSON.parse(decrypt(row.enc)) };
  } catch {
    return null;
  }
}
