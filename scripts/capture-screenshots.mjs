/**
 * Storefront screenshots for dsh-market: render the REAL components at a fixed
 * viewport so the listing can never show a UI the plugin no longer has.
 *
 *   node scripts/capture-screenshots.mjs
 *   DSH_VSCODE_URL='http://127.0.0.1:8787/?folder=/path/to/repo' node scripts/capture-screenshots.mjs
 *
 * Boots scripts/test-ui-server.mjs (bundles the current src/client sources),
 * drives Chrome through playwright, and writes:
 *   docs/screenshots/install-guide.png   every run
 *   docs/screenshots/vscode-tab.png      when DSH_VSCODE_URL points at a live code-server
 *
 * Needs Chrome (channel: chrome). Set PLAYWRIGHT_MODULE to a playwright entry
 * file when the package is not resolvable from this repo.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })

const PORT = 8897
const server = spawn(process.execPath, [join(root, 'scripts', 'test-ui-server.mjs'), '--port', String(PORT)], { stdio: 'ignore' })
const base = 'http://127.0.0.1:' + PORT + '/'

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(base)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('test-ui server did not come up on ' + base)
}

const playwrightSpec = process.env.PLAYWRIGHT_MODULE ?? 'playwright'
const playwright = await import(playwrightSpec.startsWith('/') ? pathToFileURL(playwrightSpec).href : playwrightSpec)
const { chromium } = playwright.default ?? playwright

await waitForServer()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const guide = await browser.newPage({ viewport: { width: 1100, height: 640 }, deviceScaleFactor: 2 })
  await guide.goto(base, { waitUntil: 'networkidle' })
  await guide.waitForTimeout(700)
  await guide.screenshot({ path: join(out, 'install-guide.png') })
  console.log('wrote ' + join(out, 'install-guide.png'))

  const liveUrl = process.env.DSH_VSCODE_URL
  if (liveUrl !== undefined && liveUrl !== '') {
    const tab = await browser.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 2 })
    await tab.goto(base + '?live=' + encodeURIComponent(liveUrl), { waitUntil: 'networkidle' })
    await tab.waitForTimeout(6000)
    await tab.screenshot({ path: join(out, 'vscode-tab.png') })
    console.log('wrote ' + join(out, 'vscode-tab.png'))
  }
} finally {
  await browser.close()
  server.kill()
}
