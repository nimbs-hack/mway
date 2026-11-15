import { execFileSync } from 'node:child_process'

const files = execFileSync('gofmt', ['-l', 'apps/api'], { encoding: 'utf8' }).trim()
if (files) {
  console.error(`Run gofmt -w on these files:\n${files}`)
  process.exitCode = 1
}
