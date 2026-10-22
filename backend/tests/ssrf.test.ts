// Unit test for the SSRF IP classifier. Run: npm run test:ssrf
import { classifyIp } from '../src/engine/ssrfGuard';

// [address, shouldBeBlocked]
const cases: [string, boolean][] = [
  ['127.0.0.1', true], ['10.1.2.3', true], ['172.31.255.255', true], ['172.32.0.1', false], ['192.168.0.1', true],
  ['169.254.169.254', true], ['100.64.0.1', true], ['0.0.0.0', true], ['224.0.0.1', true], ['8.8.8.8', false], ['1.1.1.1', false],
  ['::1', true], ['::', true], ['fd00::1', true], ['fe80::1', true],
  ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['0:0:0:0:0:ffff:7f00:1', true], ['::ffff:a9fe:a9fe', true], ['::7f00:1', true],
  ['64:ff9b::7f00:1', true], ['2002:7f00:1::', true], ['2001:0:4136:e378:8000:63bf:3fff:fdd2', true], ['::ffff:0:7f00:1', true],
  ['::ffff:8.8.8.8', false], ['::ffff:808:808', false], ['2606:4700:4700::1111', false], ['2001:4860:4860::8888', false],
];

let bad = 0;
for (const [ip, expected] of cases) {
  const got = classifyIp(ip).blocked;
  if (got !== expected) { bad++; console.log(`FAIL ${ip}: blocked=${got}, expected ${expected}`); }
}
console.log(bad ? `${bad} failed` : `all ${cases.length} classifications correct`);
process.exit(bad ? 1 : 0);
