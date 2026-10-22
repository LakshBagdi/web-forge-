import crypto from 'node:crypto';
import { config } from './config';

export interface EncBlob {
  iv: string;
  tag: string;
  data: string;
}

/**
 * AES-256-GCM. Credential secrets are stored only as {iv, tag, data} (all base64)
 * and are never written to the DB or returned to a client in plaintext.
 */
export function encrypt(plaintext: string): EncBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.credentialKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}

export function decrypt(blob: EncBlob): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    config.credentialKey,
    Buffer.from(blob.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
  return out.toString('utf8');
}
