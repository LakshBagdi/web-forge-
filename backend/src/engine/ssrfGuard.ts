import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config';

/**
 * Prevents workflows from reaching internal infrastructure (SSRF).
 * Every outbound URL is validated, its host resolved, and each resolved IP
 * checked against private / loopback / link-local / reserved ranges BEFORE the
 * request is made. This also defends against DNS-rebinding because we resolve
 * and pin the IP, then connect to that IP (see httpClient).
 */

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressBlockedError';
  }
}

function ipToBigInt(ip: string): bigint {
  if (net.isIPv4(ip)) {
    return ip.split('.').reduce((acc, oct) => (acc << 8n) + BigInt(Number(oct)), 0n);
  }
  // Expand IPv6 to 16 bytes
  const full = expandIPv6(ip);
  return full.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
}

function expandIPv6(ip: string): number[] {
  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1
  const v4map = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4map) {
    const v4 = v4map[1].split('.').map(Number);
    return [...new Array(10).fill(0), 0xff, 0xff, ...v4];
  }
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...new Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g || '0', 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  while (bytes.length < 16) bytes.push(0);
  return bytes.slice(0, 16);
}

interface Range { start: bigint; end: bigint; v6?: boolean; label: string; }

function cidr(ip: string, bits: number, label: string, v6 = false): Range {
  const base = ipToBigInt(ip);
  const total = v6 ? 128 : 32;
  const mask = (1n << BigInt(total - bits)) - 1n;
  const start = base & ~mask;
  return { start, end: start | mask, v6, label };
}

const V4_BLOCKS: Range[] = [
  cidr('0.0.0.0', 8, 'this-network'),
  cidr('10.0.0.0', 8, 'private'),
  cidr('100.64.0.0', 10, 'cgnat'),
  cidr('127.0.0.0', 8, 'loopback'),
  cidr('169.254.0.0', 16, 'link-local'),      // includes 169.254.169.254 cloud metadata
  cidr('172.16.0.0', 12, 'private'),
  cidr('192.0.0.0', 24, 'ietf'),
  cidr('192.168.0.0', 16, 'private'),
  cidr('198.18.0.0', 15, 'benchmark'),
  cidr('224.0.0.0', 4, 'multicast'),
  cidr('240.0.0.0', 4, 'reserved'),
];

const V6_BLOCKS: Range[] = [
  cidr('::1', 128, 'loopback', true),
  cidr('::', 128, 'unspecified', true),
  cidr('fc00::', 7, 'unique-local', true),
  cidr('fe80::', 10, 'link-local', true),
  cidr('ff00::', 8, 'multicast', true),
];

export function classifyIp(ip: string): { blocked: boolean; label?: string } {
  if (net.isIPv4(ip)) {
    const n = ipToBigInt(ip);
    for (const b of V4_BLOCKS) if (n >= b.start && n <= b.end) return { blocked: true, label: b.label };
    return { blocked: false };
  }
  if (net.isIPv6(ip)) {
    // IPv4-mapped: classify the embedded v4
    const m = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (m) return classifyIp(m[1]);
    const n = ipToBigInt(ip);
    for (const b of V6_BLOCKS) if (n >= b.start && n <= b.end) return { blocked: true, label: b.label };
    return { blocked: false };
  }
  return { blocked: true, label: 'invalid-ip' };
}

export interface ResolvedTarget {
  host: string;
  port: number;
  ip: string;
  protocol: string;
}

/**
 * Validate a URL and resolve it to a single safe IP to connect to.
 * Throws EgressBlockedError if the scheme, host, or any resolved IP is disallowed.
 */
export async function resolveSafeTarget(rawUrl: string): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressBlockedError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EgressBlockedError(`Blocked protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  const hostport = url.port ? `${host}:${port}` : host;
  const allowlisted =
    config.egressAllowlist.includes(host) || config.egressAllowlist.includes(hostport);

  // Literal IP in the URL
  if (net.isIP(host)) {
    const cls = classifyIp(host);
    if (cls.blocked && !allowlisted && !config.allowPrivateEgress) {
      throw new EgressBlockedError(`Blocked target ${host} (${cls.label})`);
    }
    return { host, port, ip: host, protocol: url.protocol };
  }

  // Resolve hostname; check every returned address.
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new EgressBlockedError(`DNS resolution failed for ${host}`);
  }
  if (addrs.length === 0) throw new EgressBlockedError(`No addresses for ${host}`);

  for (const a of addrs) {
    const cls = classifyIp(a.address);
    if (cls.blocked && !allowlisted && !config.allowPrivateEgress) {
      throw new EgressBlockedError(`${host} resolves to blocked address ${a.address} (${cls.label})`);
    }
  }
  // Pin the first address so the actual connection matches what we validated.
  return { host, port, ip: addrs[0].address, protocol: url.protocol };
}
