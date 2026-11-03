/**
 * Host loader entry for the VS Code plugin: one typert Remote service
 * (namespace 'vscodeTools') managing one code-server process per DSH Session.
 *
 * The browser face (tab registrations) lives in ./client; this file is loaded
 * only by the host. Ported from dsh-web-ide's IdeTools vscode* trio with the
 * code-server management extracted verbatim into ./vscode-server.js.
 */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import Schema from '@deepseek-ai/schemastery'
import { codeServerArgs, findCodeServer, nextFreePort, workspaceUrl, type VscodeServerEntry } from './vscode-server.js'

/** Prototype marker the typert protocol's Remote decorators write; declared
 *  here as a plain property so this package needs no decorator lowering
 *  (rolldown's native transform passes Stage-3 decorator syntax through, which
 *  Node cannot parse). The gateway's source-mode discovery and remoteMethods()
 *  readers consume exactly this shape. */
const REMOTE_METHODS_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Public shape returned to the client (iframe URL + port + ready flag). */
export interface VscodeInfo {
  readonly url: string
  readonly port: number
  readonly ready: boolean
}

export class VscodeTools extends TypertRemoteService {
  static inject = ['subprocess', 'sessions']

  /** Cordis requires a Config schema; an empty object literal is invalid
   *  (resolveConfig reads Config.validate and crashes on undefined). */
  static Config = Schema.object({})

  /** One code-server per DSH Session. */
  private readonly vscodeServers = new Map<string, VscodeServerEntry>()

  constructor(ctx: Context, _config: Record<string, never>) {
    super(ctx, 'vscodeTools')
    Object.defineProperty(Object.getPrototypeOf(this), REMOTE_METHODS_KEY, {
      configurable: true,
      value: Object.freeze({
        version: 1,
        methods: Object.freeze([
          Object.freeze({ method: 'vscodeOpen', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'vscodeStatus', invocation: Object.freeze({ kind: 'direct' }) }),
          Object.freeze({ method: 'vscodeStop', invocation: Object.freeze({ kind: 'direct' }) }),
        ]),
      }),
    })
  }

  /**
   * Start (or reuse) a code-server instance for this workspace and return the
   * iframe URL. The page embeds a real VS Code in a tab; closing the tab keeps
   * the server running so reopening is instant; "Stop Server" shuts it down.
   */
  async vscodeOpen(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    spec: { restart?: boolean },
    _signal: AbortSignal,
  ): Promise<VscodeInfo> {
    const { sessionId, workspaceRoot } = workspaceFileScope
    const existing = this.vscodeServers.get(sessionId)
    if (existing !== undefined && spec.restart !== true) {
      const ready = await this.probeVscode(existing)
      return { url: workspaceUrl(existing.origin, workspaceRoot), port: existing.port, ready }
    }
    if (existing !== undefined) await this.stopVscode(sessionId)

    const bin = findCodeServer()
    if (bin === null) {
      throw new RemoteError('vscode-tools/vscode-missing', 'code-server is not installed on this machine', {})
    }
    const port = nextFreePort(8787, [...this.vscodeServers.values()].map((e) => e.port))
    const stateDir = join(homedir(), '.dsh-ide', 'code-server')
    const origin = 'http://127.0.0.1:' + String(port)
    const handle = this.ctx.subprocess.spawn({
      argv: [bin, ...codeServerArgs({
        port,
        userDataDir: join(stateDir, 'user-data'),
        extensionsDir: join(stateDir, 'extensions'),
      })],
      cwd: workspaceRoot,
      stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 200_000 }, stderr: { maxBytes: 200_000 } },
      graceMs: 5000,
    } as never)
    this.vscodeServers.set(sessionId, { port, origin, handle, startedAt: Date.now(), ready: false })
    void handle.done.then(() => { this.vscodeServers.delete(sessionId) }).catch(() => undefined)

    // Poll until the workbench answers; a cold start measured ~1.5s.
    for (let i = 0; i < 100; i += 1) {
      const server = this.vscodeServers.get(sessionId)
      if (server === undefined) break
      if (await this.probeVscode(server)) {
        server.ready = true
        return { url: workspaceUrl(origin, workspaceRoot), port, ready: true }
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    await this.stopVscode(sessionId)
    throw new RemoteError('vscode-tools/vscode-timeout', 'code-server did not answer on its port', {})
  }

  /** Current state of this Session's VS Code server, if any. */
  async vscodeStatus(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    _signal: AbortSignal,
  ): Promise<VscodeInfo | null> {
    const server = this.vscodeServers.get(workspaceFileScope.sessionId)
    if (server === undefined) return null
    return {
      url: workspaceUrl(server.origin, workspaceFileScope.workspaceRoot),
      port: server.port,
      ready: await this.probeVscode(server),
    }
  }

  /** Stop this Session's VS Code server. */
  async vscodeStop(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    _signal: AbortSignal,
  ): Promise<void> {
    void workspaceFileScope.workspaceRoot
    await this.stopVscode(workspaceFileScope.sessionId)
  }

  /** One HTTP probe: is the workbench serving? */
  private async probeVscode(server: { origin: string }): Promise<boolean> {
    try {
      const res = await fetch(server.origin + '/', { signal: AbortSignal.timeout(1000) })
      return res.ok || res.status === 302
    } catch {
      return false
    }
  }

  private async stopVscode(sessionId: string): Promise<void> {
    const server = this.vscodeServers.get(sessionId)
    if (server === undefined) return
    this.vscodeServers.delete(sessionId)
    try { await Promise.resolve(server.handle.terminate?.()) } catch { /* already gone */ }
  }

  /** Plugin teardown: terminate every still-live code-server. The processes
   *  are children of the host, not of the browser tab; a page that reloads or
   *  unmounts would otherwise leave them running forever. */
  private async disposeAll(): Promise<void> {
    const servers = [...this.vscodeServers.values()]
    this.vscodeServers.clear()
    await Promise.allSettled(servers.map(async (server) => {
      try { await Promise.resolve(server.handle.terminate?.()) } catch { /* already gone */ }
    }))
  }
}

export default VscodeTools
