import { spawn } from 'node:child_process'

const electronBinary = process.execPath
const vite = spawn(
  electronBinary,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--configLoader',
    'native',
  ],
  { env: process.env, stdio: 'inherit' },
)

let electron = null
let shuttingDown = false

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (electron && !electron.killed) electron.kill('SIGTERM')
  if (!vite.killed) vite.kill('SIGTERM')
  process.exitCode = exitCode
}

async function waitForVite() {
  while (!shuttingDown) {
    try {
      const response = await fetch('http://127.0.0.1:5173')
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

vite.on('exit', (code) => {
  if (!shuttingDown) shutdown(code ?? 1)
})

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

await waitForVite()

if (!shuttingDown) {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...electronEnv } = process.env
  electron = spawn(electronBinary, ['.'], { env: electronEnv, stdio: 'inherit' })
  electron.on('exit', (code) => shutdown(code ?? 0))
}
