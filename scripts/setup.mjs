// One-time setup:  npm run setup      (from the project's top folder)
// Installs backend + frontend packages, creates backend/.env (if missing), and checks Postgres + Redis.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, c, checkDatabase, checkRedis } from './lib.mjs';

const major = Number(process.versions.node.split('.')[0]);
console.log(c.bold('\n⚡ FlowForge setup\n'));
if (major < 18) { console.log(c.red(`✗ Node ${process.versions.node} is too old. Install Node 18 or newer (https://nodejs.org).`)); process.exit(1); }
console.log(c.green(`✓ Node ${process.versions.node}`));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const dir of ['backend', 'frontend']) {
  console.log(c.cyan(`\n→ Installing ${dir} packages (this takes a minute the first time)…`));
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, dir), stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.log(c.red(`\n✗ npm install failed in ${dir}.`));
    console.log('  If you moved this folder between Windows and WSL, delete its node_modules first:');
    console.log(c.bold(`    rm -rf ${dir}/node_modules && npm run setup`));
    process.exit(1);
  }
}

const envFile = path.join(root, 'backend', '.env');
if (!fs.existsSync(envFile)) {
  const example = fs.readFileSync(path.join(root, 'backend', '.env.example'), 'utf8')
    // Only the login-session secret is randomised. CREDENTIAL_KEY stays empty on purpose: in development the app then uses
    // a fixed key, so logins you already saved (X, Google…) keep working after setup. Set your own key before deploying.
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
  fs.writeFileSync(envFile, example);
  console.log(c.green('\n✓ Created backend/.env (keep this file private). Saved logins from before keep working.'));
} else {
  console.log(c.green('\n✓ backend/.env already exists — left as it is.'));
}

console.log(c.cyan('\n→ Checking the services FlowForge needs…'));
const dbOk = await checkDatabase();
const redisOk = await checkRedis();
if (dbOk && redisOk) {
  console.log(c.bold(c.green('\n🎉 All set. Start the app with:  npm run dev   then open http://localhost:5173\n')));
} else {
  console.log(c.bold(c.yellow('\nAlmost there — fix the ✗ items above, then run:  npm run setup   again (it is safe to repeat).\n')));
  process.exit(2);
}
