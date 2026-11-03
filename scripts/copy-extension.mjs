/** Copy the VS Code extension sources into lib/vscode-extension so the host
 *  bundle can install it into the code-server extensions dir at spawn time. */
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'vscode-extension')
const dst = join(here, '..', 'lib', 'vscode-extension')

if (!existsSync(join(src, 'extension.js'))) {
  console.error('copy-extension: vscode-extension/extension.js not found')
  process.exit(1)
}
await rm(dst, { recursive: true, force: true })
await mkdir(dirname(dst), { recursive: true })
await cp(src, dst, { recursive: true })
console.log('copy-extension: lib/vscode-extension updated')
