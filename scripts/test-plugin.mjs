/**
 * Static checks for the dsh-web-vscode plugin: host helpers, wiring,
 * manifest parity, and (when code-server is installed) a real
 * spawn/probe/stop round trip. Ported from dsh-web-ide's test-vscode-server.mjs.
 */
import { codeServerArgs, codeServerCandidates, findCodeServer, nextFreePort, workspaceUrl } from '../src/vscode-server.ts'
import { readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

let failed = 0
const check = (n, ok, d) => { if (!ok) failed += 1; console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok || d === undefined ? '' : '  -> ' + d)) }
const src = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// --- args ---
const args = codeServerArgs({ port: 8787, userDataDir: '/u', extensionsDir: '/e' })
check('binds loopback only', args.join(' ').includes('--bind-addr 127.0.0.1:8787'))
check('authentication is off (loopback only)', args.join(' ').includes('--auth none'))
check('workspace trust disabled so extensions activate', args.includes('--disable-workspace-trust'))
check('telemetry and update checks off', args.includes('--disable-telemetry') && args.includes('--disable-update-check'))
check('uses the provided state dirs', args.includes('/u') && args.includes('/e'))

// --- url + ports ---
check('workspace url encodes the folder', workspaceUrl('http://127.0.0.1:8787', '/tmp/my proj') === 'http://127.0.0.1:8787/?folder=%2Ftmp%2Fmy%20proj')
check('url keeps origin intact', workspaceUrl('http://127.0.0.1:8787', '/a').startsWith('http://127.0.0.1:8787/'))
const occupied = await nextFreePort(8787, []) // whatever the OS gives us on 8787+ (8787 may be held by dsh-web-ide)
check('free port skips one in use', await nextFreePort(8787, [occupied]) === occupied + 1 || (await nextFreePort(8787, [occupied])) !== occupied)
check('free port probes the OS (8787 held by another process is skipped)', await nextFreePort(8787, []) !== 8787 || isFree(8787) === true)
async function isFree(p) { // true when 8787 is genuinely bindable — else some other process holds it
  const { createServer } = await import('node:http')
  return await new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(false))
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}
check('honours DSH_IDE_VSCODE_BIN first', codeServerCandidates({ DSH_IDE_VSCODE_BIN: '/x/cs' })[0] === '/x/cs')
check('probes several standard locations', codeServerCandidates({ HOME: '/h' }).length >= 3)
check('findCodeServer returns null for a bogus path', findCodeServer({ DSH_IDE_VSCODE_BIN: '/nonexistent/code-server', HOME: '/nonexistent-home', PATH: '' }) === null)
check('searches every PATH entry', codeServerCandidates({ HOME: '/h', PATH: '/a/bin' + delimiter + '/b bin' }).includes(join('/b bin', 'code-server')))
check('findCodeServer ignores entries that do not exist', findCodeServer({ HOME: '/nonexistent-home', PATH: '/nonexistent-a:/nonexistent-b' }) === null)

// --- wiring ---
{
  const view = src('src/client/VscodeView.tsx')
  const client = src('src/client/index.ts')
  const host = src('src/index.ts')
  check('view auto-opens the server on mount', view.includes('autoOpenedFor') && view.includes('void openVscode()'))
  check('iframe points at the served url', view.includes('src={info.url}'))
  check('missing code-server is explained', view.includes('vscode.notInstalled'))
  check('conversation view tab registered after chat', client.includes("'conversation.view'") && client.includes('order: 1'))
  check('sidebar tab type registered', client.includes('sidebarRightTabs') && client.includes("kind: 'vscode'") || (client.includes('sidebarRightTabs') && client.includes("const VSCODE_KIND = 'vscode'")))
  check('sidebar tab body registered under its id', client.includes("'sidebar.right.pane.tab'") && client.includes('key: VSCODE_TAB_ID'))
  check('auto-fullscreen one-shot latch present', client.includes('forcedRef') && client.includes('requestFullscreenPanel'))
  check('host exposes vscodeOpen/Status/Stop', host.includes('async vscodeOpen(') && host.includes('async vscodeStatus(') && host.includes('async vscodeStop('))
  check('host spawns the discovered binary', host.includes('argv: [bin, ...codeServerArgs('))
  check('host tears down servers on dispose', host.includes('disposeAll'))
  const extPkg = src('vscode-extension/package.json')
  const ext = src('vscode-extension/extension.js')
  check('AI commit: host method present', host.includes('async generateCommitMessage('))
  check('AI commit: bridge env passed to code-server', host.includes('DSH_AI_BRIDGE_URL'))
  check('AI commit: bridge binds loopback only', host.includes("'127.0.0.1'"))
  check('AI commit: extension button in scm/title navigation group', extPkg.includes('"scm/title"') && extPkg.includes('navigation@-1'))
  check('AI commit: extension reads bridge URL from env', ext.includes('DSH_AI_BRIDGE_URL'))
  check('AI commit: extension writes into the scm input box', ext.includes('input.value = body.message'))
  check('AI commit: second click cancels generation', ext.includes('inFlight.abort()'))
  const theme = src('src/client/theme.ts')
  check('composer seat hidden while vscode view mounted', theme.includes(`:has([data-vscode-view]) ~ [data-composer-seat]{display:none}`))
  check('width handles hidden while vscode view mounted', theme.includes(`:has([data-vscode-view]) ~ [data-width-handle]{display:none !important}`))
  check('session container stretches under vscode view', theme.includes(`:has([data-vscode-view]) > div{flex:1 1 0%`))
  check('view root carries the data-vscode-view marker', view.includes('data-vscode-view=""'))
}

// --- manifest parity ---
{
  const grab = (file) => {
    const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    return [...text.matchAll(/method: '([A-Za-z]+)'/g)].map((m) => m[1]).sort()
  }
  const shared = grab('src/typert.shared.ts')
  const host = [...grab('src/typert.host.ts'), ...shared]
  const client = [...grab('src/typert.remote-client.ts'), ...shared]
  const uniq = (a) => [...new Set(a)]
  check('client manifest lists every host method', uniq(host).join(',') === uniq(client).join(','),
    'missing from client: ' + uniq(host).filter((m) => !client.includes(m)).join(',') || '(none)')
  check('vscode methods reach the browser proxy', client.includes('vscodeOpen') && client.includes('vscodeStop'))
}

// --- live round trip (only when installed) ---
const bin = findCodeServer()
if (bin === null) {
  console.log('skip live round trip: code-server not installed')
} else {
  const { spawn } = await import('node:child_process')
  const port = 8901 + Math.floor(Math.random() * 60)
  const child = spawn(bin, codeServerArgs({ port, userDataDir: '/tmp/dsh-vscode-t-u', extensionsDir: '/tmp/dsh-vscode-t-e' }), { stdio: 'ignore' })
  let up = false
  for (let i = 0; i < 80 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 200))
    try { const res = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(700) }); up = res.ok || res.status === 302 } catch { /* not yet */ }
  }
  check('e2e: code-server answers on its port', up)
  child.kill()
  await new Promise((r) => setTimeout(r, 300))
}

console.log(failed === 0 ? '\nall checks passed' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
