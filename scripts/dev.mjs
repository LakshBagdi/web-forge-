// Start everything with ONE command:  npm run dev      (from the project's top folder)
// Runs the backend (port 4000) and the frontend (port 5173) together; Ctrl+C stops both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { root, c, checkDatabase, checkRedis, portOpen, backendPort } from './lib.mjs';

console.log(c.bold('\n⚡ FlowForge — starting\n'));
for (const dir of ['backend', 'frontend']) {
  if (!fs.existsSync(path.join(root, dir, 'node_modules'))) {
    console.log(c.red(`✗ ${dir} packages are not installed yet. Run once:  ${c.bold('npm run setup')}`));
    process.exit(1);
  }
}
const bp = backendPort();
const dbOk = await checkDatabase();
const redisOk = await checkRedis();
if (!dbOk || !redisOk) { console.log(c.yellow('\nFix the ✗ item(s) above, then run  npm run dev  again. (npm run setup explains each fix.)\n')); process.exit(2); }

for (const [port, name] of [[bp, 'backend'], [5173, 'frontend']]) {
  if (await portOpen(port)) {
    console.log(c.red(`✗ Port ${port} is already in use — an older copy of the ${name} is probably still running.`));
    console.log(`  Stop it:  ${c.bold(`fuser -k ${port}/tcp`)}   (or close the other terminal), then run  npm run dev  again.`);
    process.exit(3);
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const kids = [];
let stopping = false;
const stopAll = (code = 0) => {
  if (stopping) return; stopping = true;
  for (const k of kids) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(k.pid), '/T', '/F']) : process.kill(-k.pid, 'SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => process.exit(code), 400);
};
function start(name, dir, color) {
  const child = spawn(npm, ['run', 'dev'], { cwd: path.join(root, dir), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '1' } });
  kids.push(child);
  const tag = color(`[${name}]`);
  const pipe = (stream) => { let buf = ''; stream.on('data', (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); for (const l of lines) if (l.trim()) console.log(`${tag} ${l}`); }); };
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', (code) => { if (!stopping) { console.log(c.red(`\n✗ The ${name} stopped (exit ${code}). Scroll up for the reason. Stopping everything.`)); stopAll(1); } });
}
start('backend', 'backend', c.cyan);
start('frontend', 'frontend', c.yellow);
process.on('SIGINT', () => { console.log(c.dim('\nStopping…')); stopAll(0); });
process.on('SIGTERM', () => stopAll(0));

// Tell the user when it is really ready.
const t0 = Date.now();
const wait = setInterval(async () => {
  if (stopping) return clearInterval(wait);
  const api = await fetch(`http://127.0.0.1:${bp}/api/health`).then((r) => r.ok).catch(() => false);
  const web = await portOpen(5173);
  if (api && web) {
    clearInterval(wait);
    console.log(c.bold(c.green('\n✅ Ready!  Open  http://localhost:5173  in your browser.   (Press Ctrl+C here to stop.)\n')));
  } else if (Date.now() - t0 > 60000) {
    clearInterval(wait);
    console.log(c.yellow('\n… still starting after 60s. Check the [backend] / [frontend] lines above for errors.'));
  }
}, 1000);
