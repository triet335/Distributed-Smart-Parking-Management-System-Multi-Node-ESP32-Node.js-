const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const builder = spawn(process.execPath, ['scripts/build.js', '--watch'], { cwd: root, stdio: 'inherit' });
const server = spawn(process.execPath, ['--watch', 'server.js'], { cwd: root, stdio: 'inherit' });
function stop() { builder.kill(); server.kill(); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
for (const child of [builder, server]) child.once('exit', code => { stop(); process.exitCode = code || 0; });
