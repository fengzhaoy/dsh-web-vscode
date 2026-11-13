/**
 * Harness entry for scripts/capture-screenshots.mjs: mounts the REAL VscodeView
 * against a stub vscodeTools face.
 *   /            -> answers like a host with no code-server (install guide)
 *   ?live=<url>  -> answers like a running server (embedded workbench)
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { VscodeView } from '../../src/client/VscodeView.js'
import { zh } from '../../src/client/locales.js'
import { VSCODE_STYLES } from '../../src/client/theme.js'

const style = document.createElement('style')
style.textContent = VSCODE_STYLES
document.head.appendChild(style)

const live = new URLSearchParams(location.search).get('live')
const t = (key: string, params?: Record<string, string | number>): string => {
  let text = (zh as Record<string, string>)[key] ?? key
  if (params !== undefined) for (const [name, value] of Object.entries(params)) text = text.split('{' + name + '}').join(String(value))
  return text
}

const missing = {
  ok: false as const,
  error: {
    code: 'vscode-tools/vscode-missing',
    message: 'code-server is not installed on this machine',
    details: {
      searchedPaths: ['/Users/me/.nvm/versions/node/v24.14.0/bin/code-server', '/usr/local/bin/code-server', '/opt/homebrew/bin/code-server'],
      platform: 'darwin',
    },
  },
}
const liveInfo = { url: live ?? '', port: 8787, ready: true }
const vscodeTools = {
  vscodeOpen: async () => (live === null ? missing : { ok: true as const, value: liveInfo }),
  vscodeStatus: async () => ({ ok: true as const, value: live === null ? null : liveInfo }),
  vscodeStop: async () => ({ ok: true as const, value: undefined }),
}

const host = document.createElement('div')
host.style.cssText = 'position:relative;height:100%'
document.getElementById('root')!.appendChild(host)

createRoot(host).render(createElement(VscodeView as never, { sessionId: 'preview', cwd: '/workspace', vscodeTools, t } as never))
