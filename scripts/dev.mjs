// Cross-platform dev launcher: runs `next dev -p 3000` and mirrors all
// output to dev.log — the Node equivalent of `next dev 2>&1 | tee dev.log`,
// but it also works on Windows (cmd/PowerShell), where `tee` doesn't exist.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';

const log = createWriteStream(path.join(process.cwd(), 'dev.log'), { flags: 'w' });
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3000'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

const mirror = (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
};
child.stdout.on('data', mirror);
child.stderr.on('data', mirror);

child.on('exit', (code) => {
  log.end();
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
    log.end();
    process.exit(0);
  });
}
