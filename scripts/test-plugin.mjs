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
check('free port skips one in use', await nextFreePort(8787, [8787]) !== 8787)
{
  // Self-contained OS probe check: hold a port ourselves, then ask nextFreePort
  // for it WITHOUT listing it in inUse — it must skip the genuinely-occupied port.
  const { createServer } = await import('node:http')
  const held = await new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(null))
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  if (held === null) {
    check('free port probes the OS (occupied port is skipped)', false, 'could not bind a probe port')
  } else {
    const addr = held.address()
    const picked = await nextFreePort(addr.port - 1, [])
    check('free port probes the OS (occupied port is skipped)', picked !== addr.port, 'picked ' + picked + ', held ' + addr.port)
    await new Promise((r2) => held.close(() => r2()))
  }
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
  check('view auto-opens the server on first mount', view.includes('await openVscode()'))
  check('view adopts an already-loaded frame instead of reloading', view.includes('hasVscodeFrame(cached)'))
  // Missing code-server: a setup state with an install guide (ported from
  // dsh-web-ide), not a bare error box.
  const locales = src('src/client/locales.ts')
  const themeSrc = src('src/client/theme.ts')
  const errorsDts = src('src/remote-errors.d.ts')
  const typesSrc = src('src/client/types.ts')
  check('missing code-server renders the install guide', view.includes('vscode-missing-guide') && view.includes("error.kind === 'missing'"))
  check('start failures keep the plain error box', view.includes("error.kind === 'start'") && view.includes('data-testid="vscode-error"'))
  check('guide lists the probed paths', view.includes('searchedPaths.slice(0, 12)') && view.includes("t('vscode.missing.searchedPaths')"))
  check('guide offers brew on macOS', view.includes("platform === 'darwin'") && view.includes('brew install code-server'))
  check('guide offers npm elsewhere', view.includes('npm install -g code-server'))
  check('guide commands are copyable', view.includes('copyText(command)') && view.includes('data-testid="vscode-copy-command"'))
  check('guide points at DSH_IDE_VSCODE_BIN', view.includes('DSH_IDE_VSCODE_BIN=/path/to/code-server'))
  check('guide has a retry button', view.includes('data-testid="vscode-missing-retry"'))
  check('guide styles shipped', themeSrc.includes('.vscode-guide-title') && themeSrc.includes('.vscode-guide-retry'))
  // Keyed as 'vscode.missing.*' (NOT bare 'missing.*') in both dictionaries.
  check('guide is localized in zh and en', ['title', 'reason', 'searchedPaths', 'install', 'recommended', 'afterInstall', 'pathHint', 'copyCommand'].every((k) => locales.split("'vscode.missing." + k + "'").length - 1 === 2))
  check('host reports searchedPaths + platform for a missing binary', host.includes("'vscode-tools/vscode-missing'") && host.includes('searchedPaths: codeServerCandidates()') && host.includes('platform: process.platform'))
  check('failure details are declared on the protocol map', errorsDts.includes('searchedPaths?: readonly string[]') && errorsDts.includes('platform?: string'))
  check('view type keeps the guide payload', typesSrc.includes("kind: 'missing'") && typesSrc.includes('searchedPaths: readonly string[]'))
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
  check('Config is a schemastery schema (cordis calls ~standard.validate)', host.includes('static Config = z.object({})'))
  check('extension dir resolved ESM-safely (no __dirname in ESM bundle)', host.includes('fileURLToPath(import.meta.url)') && !host.includes('join(__dirname'))
  // Regression: a null relativeLocation makes the workbench's profile scanner
  // throw "Invalid extensions content", aborting the whole user-extension scan
  // on every load — which kills the builtin git extension with it, so Source
  // Control shows neither the change badge nor the changed files. The scanner
  // validates `isString(relativeLocation) || isUri(relativeLocation)`.
  const manifestBlock = host.slice(host.indexOf('entries.push({'), host.indexOf('await writeFile(manifestPath'))
  check('extensions.json relativeLocation is a string, never null', !/relativeLocation:\s*null/.test(manifestBlock) && /relativeLocation:\s*basename\(/.test(manifestBlock))
  check('extensions.json targetPlatform is a real value', !/targetPlatform:\s*'undefined'/.test(manifestBlock) && /targetPlatform:\s*'universal'/.test(manifestBlock))
  check('AI commit: bridge env passed to code-server', host.includes('DSH_AI_BRIDGE_URL'))
  check('AI commit: bridge binds loopback only', host.includes("'127.0.0.1'"))
  check('AI commit: extension button in scm/title navigation group', extPkg.includes('"scm/title"') && extPkg.includes('navigation@-1'))
  check('AI commit: when clause matches the git scm provider context key', extPkg.includes('"when": "scmProvider == git"'))
  check('workbench opens on Source Control by default', ext.includes("workbench.view.scm") && extPkg.includes('"dsh-ai-commit.openScmOnStart"'))
  check('AI commit: extension reads bridge URL from env', ext.includes('DSH_AI_BRIDGE_URL'))
  check('AI commit: extension writes into the scm input box', ext.includes('input.value = body.message'))
  check('AI commit: second click cancels generation', ext.includes('inFlight.abort()'))
  const theme = src('src/client/theme.ts')
  check('composer seat hidden while vscode view mounted', theme.includes(`:has([data-vscode-view]) ~ [data-composer-seat]{display:none}`))
  check('width handles hidden while vscode view mounted', theme.includes(`:has([data-vscode-view]) ~ [data-width-handle]{display:none !important}`))
  check('session container stretches under vscode view', theme.includes(`:has([data-vscode-view]) > div{flex:1 1 0%`))
  check('view root carries the data-vscode-view marker', view.includes('data-vscode-view=""'))
  check('view mounts the persistent overlay for a served url', view.includes('mountFrame(res.value.url)'))
  check('view parks the overlay when its body unmounts', view.includes('useEffect(() => () => { parkVscodeFrame() }, [])'))
  const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('view never renders the iframe in its own tree', !/<iframe[\s>]/.test(viewCode) && view.includes('shownUrl') && view.includes('showVscodeFrame'))
  check('only an explicit restart destroys the frame', (view.match(/destroyVscodeFrame\(\)/g) ?? []).length === 2 && view.includes('if (restart) destroyVscodeFrame()'))
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

// --- persistent overlay (behavioural, needs no browser) ---
// The whole point: an iframe that leaves the document is destroyed by the
// browser, so the frame must live OUTSIDE React and a tab switch must only
// hide it. These checks drive vscodeFrameHost against a minimal DOM stub and
// assert the frame node is never detached.
{
  const mk = (tag) => {
    // `attrs` holds DOM attributes; `className` is a plain property, like the DOM.
    const attrs = {}
    const el = {
      tag, attrs, className: '', style: {}, children: [], parent: null, isConnected: true, src: '',
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = String(v) },
      appendChild: (c) => { c.parent = el; el.children.push(c); return c },
      remove: () => {
        const kids = el.parent?.children
        if (kids !== undefined) { const i = kids.indexOf(el); if (i >= 0) kids.splice(i, 1) }
        el.parent = null
        el.isConnected = false
      },
      getBoundingClientRect: () => ({ top: 50, left: 10, width: 800, height: 600, right: 810, bottom: 650 }),
      closest: () => null,
      querySelector: (s) => s.includes('vscode-anchor') ? (anchor.isConnected ? anchor : null) : null,
    }
    return el
  }
  const body = mk('body')
  const anchor = mk('div')
  anchor.isConnected = false
  const doc = {
    body,
    documentElement: body,
    createElement: (tag) => mk(tag),
    querySelector: (s) => s.includes('vscode-anchor') ? (anchor.isConnected ? anchor : null) : null,
  }
  const win = { innerWidth: 1600, innerHeight: 1000, document: doc }
  let rafCb = null
  const raf = (f) => { rafCb = f; return 1 }
  win.requestAnimationFrame = raf
  win.cancelAnimationFrame = () => { rafCb = null }
  const g = globalThis
  g.window = win
  g.document = doc
  // The host uses the bare requestAnimationFrame global, exactly like a page.
  g.requestAnimationFrame = raf
  g.cancelAnimationFrame = () => { rafCb = null }
  const host = await import('../src/client/vscodeFrameHost.ts')
  const URL0 = 'http://127.0.0.1:9001/?folder=%2Fw'

  anchor.isConnected = true
  body.appendChild(anchor)
  host.showVscodeFrame(URL0, anchor)
  rafCb?.()
  const overlay = body.children.find((c) => c.className === 'vscode-overlay')
  const frame0 = overlay?.children[0]
  check('overlay container lives on <body>, not in React', overlay !== undefined)
  check('first show creates the frame', frame0?.tag === 'iframe' && (frame0.attrs['src'] ?? frame0.src) === URL0)
  check('a shown overlay gets the anchor rect', overlay?.style.width === '800px' && overlay?.attrs['data-hidden'] === 'false')
  check('a live frame is reported as cached', host.hasVscodeFrame(URL0) === true)

  // Tab switch: the body unmounts -> anchor leaves the document. The frame
  // must stay attached (that is what keeps its document alive).
  anchor.remove()
  anchor.isConnected = false
  rafCb?.()
  check('unmounted anchor parks the overlay', overlay?.attrs['data-hidden'] === 'true')
  check('parking NEVER detaches the frame', body.children.some((c) => c.children[0] === frame0))
  check('parked frame is still cached', host.hasVscodeFrame(URL0) === true && body.children.some((c) => c.children[0] === frame0))

  // Tab switch back: a NEW anchor mounts; the SAME frame must be reused.
  body.appendChild(anchor)
  anchor.isConnected = true
  host.showVscodeFrame(URL0, anchor)
  rafCb?.()
  check('re-showing reuses the same iframe (no reload)', body.children.find((c) => c.className === 'vscode-overlay')?.children[0] === frame0)
  check('re-shown overlay is visible again', overlay?.attrs['data-hidden'] === 'false')

  // Hidden by the host (right sidebar inactive tab): invisible box parks it.
  anchor.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 })
  rafCb?.()
  check('a hidden anchor parks the overlay', overlay?.attrs['data-hidden'] === 'true')

  // Explicit reload / stop: the only path that really destroys the frame.
  anchor.getBoundingClientRect = () => ({ top: 50, left: 10, width: 800, height: 600, right: 810, bottom: 650 })
  host.destroyVscodeFrame()
  check('destroy removes the frame for real', !body.children.some((c) => c.children[0] === frame0) && host.hasVscodeFrame(URL0) === false)
  check('a different url builds a fresh frame', (() => { host.showVscodeFrame('http://127.0.0.1:9002/', anchor); rafCb?.(); return (body.children.find((c) => c.className === 'vscode-overlay')?.children[0])?.src === 'http://127.0.0.1:9002/' })())
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