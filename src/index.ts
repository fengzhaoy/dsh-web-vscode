/**
 * Host loader entry for the VS Code plugin: one typert Remote service
 * (namespace 'vscodeTools') managing one code-server process per DSH Session,
 * plus the AI commit-message generator (LLM via ctx.llm, ported verbatim
 * from dsh-web-ide's IdeTools.gitGenerateCommitMessage) exposed both as a
 * Remote method and through a localhost HTTP bridge that the bundled VS Code
 * extension (vscode-extension/) calls from inside code-server.
 *
 * The browser face (tab registrations) lives in ./client; this file is loaded
 * only by the host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { codeServerArgs, codeServerCandidates, findCodeServer, nextFreePort, workspaceUrl, type VscodeServerEntry } from './vscode-server.js'

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

/** Result of the AI commit-message generator. */
export interface CommitMessageResult {
  readonly message: string
}

/** One running code-server + the AI bridge bound to it. */
interface VscodeServerEntryWithBridge extends VscodeServerEntry {
  /** The AI bridge HTTP server, if this host could start one. */
  bridge?: { server: Server; port: number }
}

export class VscodeTools extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'llm', 'agentDefaultModel']

  static Config = z.object({})

  /** One code-server per DSH Session. */
  private readonly vscodeServers = new Map<string, VscodeServerEntryWithBridge>()

  private static readonly GIT_STDOUT_MAX_BYTES = 8 * 1024 * 1024
  private static readonly GIT_STDERR_MAX_BYTES = 16 * 1024
  private static readonly GIT_TIMEOUT_MS = 20_000

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
          Object.freeze({ method: 'generateCommitMessage', invocation: Object.freeze({ kind: 'direct' }) }),
        ]),
      }),
    })
  }

  /**
   * Start (or reuse) a code-server instance for this workspace and return the
   * iframe URL. The page embeds a real VS Code in a tab; closing the tab keeps
   * the server running so reopening is instant; "Stop Server" shuts it down.
   *
   * An AI bridge (localhost HTTP) is started alongside and its URL is passed
   * to the child via env DSH_AI_BRIDGE_URL — the bundled VS Code extension
   * POSTs {workspaceRoot} to it to generate commit messages with the host's
   * configured LLM.
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
      // Carry the probe result across the wire: the guide lists exactly where
      // this process looked and on which platform, so a user who DID install
      // code-server (e.g. through nvm, invisible to dsh web's PATH) can see the
      // real cause instead of a generic "not found".
      throw new RemoteError('vscode-tools/vscode-missing', 'code-server is not installed on this machine', {
        searchedPaths: codeServerCandidates(),
        platform: process.platform,
      })
    }
    const port = await nextFreePort(8787, [...this.vscodeServers.values()].map((e) => e.port))
    const stateDir = join(homedir(), '.dsh-ide', 'code-server')
    const origin = 'http://127.0.0.1:' + String(port)

    // The AI bridge: one localhost HTTP server per code-server child. Loopback
    // only, single JSON route, no auth beyond locality (same posture as the
    // code-server itself, which binds 127.0.0.1 with --auth none).
    const bridge = await this.startBridge(sessionId)
    const env: NodeJS.ProcessEnv = {}
    if (bridge !== null) env.DSH_AI_BRIDGE_URL = 'http://127.0.0.1:' + String(bridge.port) + '/commit-message'

    // Make sure the bundled AI-commit extension is present in the shared
    // extensions dir (idempotent copy from this package's lib/vscode-extension).
    const extensionsDir = join(stateDir, 'extensions')
    await this.installBundledExtension(extensionsDir)

    const handle = this.ctx.subprocess.spawn({
      argv: [bin, ...codeServerArgs({
        port,
        userDataDir: join(stateDir, 'user-data'),
        extensionsDir,
      })],
      cwd: workspaceRoot,
      env,
      stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 200_000 }, stderr: { maxBytes: 200_000 } },
      graceMs: 5000,
    } as never)
    this.vscodeServers.set(sessionId, { port, origin, handle, startedAt: Date.now(), ready: false, bridge: bridge ?? undefined })
    void handle.done.then(() => { this.stopBridge(sessionId); this.vscodeServers.delete(sessionId) }).catch(() => undefined)

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
    throw new RemoteError('vscode-tools/vscode-timeout', 'code-server did not answer on its port', {
      platform: process.platform,
    })
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

  /**
   * AI-generate a commit message from the workspace's uncommitted changes,
   * using the currently configured LLM (agentDefaultModel). Ported verbatim
   * from dsh-web-ide's IdeTools.gitGenerateCommitMessage.
   *
   * Mirrors the VS Code SCM AI assistants (Copilot / WeCode): the staged diff
   * is preferred when the index holds changes, otherwise the whole working
   * tree is used. The prompt also carries the branch name and the recent
   * commit subjects so the message matches the repository's language and
   * message conventions. The diff is capped per file section at 32 KiB and
   * the model output is sanitized (fences/labels stripped) before it lands in
   * the commit input.
   */
  async generateCommitMessage(
    workspaceFileScope: { sessionId: string; workspaceRoot: string },
    signal: AbortSignal | undefined,
  ): Promise<CommitMessageResult> {
    const { workspaceRoot: cwd } = workspaceFileScope
    if (!cwd) throw new RemoteError('vscode-tools/no-workspace', 'workspace root is not set', {})

    let diff = ''
    let diffSource: 'staged' | 'working-tree' = 'working-tree'
    const untracked: string[] = []
    try {
      const statusRaw = await this.runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], signal)
      for (const part of statusRaw.split('\u0000')) {
        if (part.startsWith('?? ')) untracked.push(part.slice(3))
      }
      if (untracked.length > 0) {
        try { await this.runGit(cwd, ['add', '-N', '--', ...untracked], signal) } catch { /* ignore */ }
      }
      // VS Code SCM assistants prefer the staged diff when the index holds
      // changes, and fall back to the whole working tree otherwise.
      diff = await this.runGit(cwd, ['diff', '--cached', '--no-color'], signal)
      if (diff.trim().length > 0) {
        diffSource = 'staged'
      } else {
        // Unborn repository: `git diff HEAD` exits 128 — treat it as empty
        // so the plain worktree diff below takes over (it works on unborn
        // and includes the intent-to-add content).
        diff = await this.runGit(cwd, ['diff', 'HEAD', '--no-color'], signal).catch(() => '')
        if (diff.trim().length === 0) {
          diff = await this.runGit(cwd, ['diff', '--no-color'], signal)
        }
      }
    } catch (err) {
      if (err instanceof RemoteError && (err.code === 'vscode-tools/not-a-repo')) {
        throw new RemoteError('vscode-tools/not-a-repo', 'workspace is not a git repository', {})
      }
      throw err
    } finally {
      // Undo the intent-to-add marks: they linger in the index otherwise —
      // rendering as '.A' status entries and never being committed by a
      // plain `git commit` (git does not count i-t-a as staged changes).
      // Resetting exactly the paths we marked restores the pristine
      // untracked state, whatever happened above.
      if (untracked.length > 0) {
        try { await this.runGit(cwd, ['reset', '-q', '--', ...untracked], signal) } catch { /* ignore */ }
      }
    }

    if (diff.trim().length === 0) {
      throw new RemoteError('vscode-tools/no-changes', 'no uncommitted changes to generate a message from', {})
    }

    // Style context: the branch name and the recent commit subjects teach the
    // model the repository's language and message conventions (both are best
    // effort — a missing history or detached HEAD must not block generation).
    const branch = await this.runGit(cwd, ['branch', '--show-current'], signal).catch(() => '')
    const recentSubjects = await this.runGit(cwd, ['log', '--format=%s', '-n', '10'], signal).catch(() => '')

    const MAX_DIFF = 32 * 1024
    const trimmed = this.truncateDiffForPrompt(diff, MAX_DIFF)

    const ctx = this.ctx as Context & { llm?: { stream(options: never): AsyncIterable<{ type: string; text?: string }> }; agentDefaultModel?: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } } }
    if (!ctx.llm) {
      throw new RemoteError('vscode-tools/llm-unavailable', 'LLM service is not available', {})
    }
    const selection = ctx.agentDefaultModel?.currentSelection()
    if (!selection || !selection.provider || !selection.model) {
      throw new RemoteError('vscode-tools/no-model', 'no model is configured', {})
    }

    const systemPrompt = [
      'You are an expert software engineer who writes git commit messages.',
      'You will receive the current branch name, the recent commit subjects, and a git diff.',
      'Generate ONE commit message following the Conventional Commits specification:',
      '  <type>(<optional scope>): <subject>',
      '  <optional body>',
      '',
      'Rules:',
      '- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert',
      '- subject: imperative mood, no trailing period, max 50 chars',
      '- body (optional): wrap at 72 chars, explain what and why (not how); separate it from the subject with one blank line',
      '- When recent commit subjects are provided, match their language and phrasing style (e.g. write Chinese if the history is Chinese); otherwise use the language of the diff, else English.',
      '- Focus on the meaningful source changes; ignore generated/build artifacts when real changes exist.',
      '- Output ONLY the commit message: no markdown fences, no quotes, no explanations.',
    ].join('\n')

    const styleBlock = recentSubjects.trim().length > 0
      ? 'Recent commit subjects (style reference):\n' + recentSubjects.trim()
      : 'No recent commit history available.'
    const userText = [
      'Branch: ' + (branch.trim().length > 0 ? branch.trim() : '(unknown)'),
      '',
      styleBlock,
      '',
      diffSource === 'staged' ? 'Staged changes (git diff --cached):' : 'Working tree changes (git diff HEAD):',
      '',
      '\x60\x60\x60',
      trimmed,
      '\x60\x60\x60',
    ].join('\n')

    // Build a properly identified + frozen user message using the dsh-llm
    // helper (hand-built messages missing the id field crash the adapter).
    // This plugin-initiated prompt is a user-authored request, so 'user' is
    // the faithful attribution.
    const messages = [createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
    })]

    // No explicit maxTokens: a hardcoded 2048 cap starves reasoning models
    // — they spend the whole budget on reasoning and return no text. With the
    // cap unset, the dsh-llm adapter applies the bound model's
    // defaultMaxTokens, leaving room for both reasoning and the message.
    const options = deepFreeze({
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort as never,
      system: systemPrompt,
      messages,
      signal,
    } as never)

    // Use BlockAssembler to robustly collect all text from the stream, and keep the terminal
    // finish chunk: adapter failures arrive as an error-kind finish (not a thrown exception), so
    // ignoring it would mask the real cause behind a misleading "empty message".
    const assembler = new BlockAssembler()
    let finish: { kind?: string; failure?: { code?: string; message?: string } } | undefined
    for await (const chunk of ctx.llm.stream(options)) {
      if (signal?.aborted) break
      if ((chunk as { type?: string }).type === 'finish') {
        finish = (chunk as { reason?: { kind?: string; failure?: { code?: string; message?: string } } }).reason
        continue
      }
      assembler.push(chunk as never)
    }

    if (signal?.aborted || finish?.kind === 'aborted') {
      throw new RemoteError('vscode-tools/aborted', 'commit message generation was cancelled', {})
    }
    if (finish?.kind === 'error') {
      const cause = finish.failure?.message ?? finish.failure?.code ?? 'unknown adapter failure'
      throw new RemoteError('vscode-tools/llm-failed', cause, {})
    }

    const blocks = assembler.blocks()
    const message = this.sanitizeCommitMessage(
      blocks.map((b) => (b as { text?: string }).text ?? '').join(''),
    )
    if (message.length === 0) {
      throw new RemoteError('vscode-tools/llm-empty', 'the model returned an empty commit message', {})
    }
    return { message }
  }

  // ---------- git plumbing (ported from dsh-web-ide's IdeTools) ----------

  private async runGit(
    workspaceRoot: string,
    argv: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const spec = {
      argv: ['git', ...argv],
      cwd: workspaceRoot,
      stdio: {
        stdin: 'ignore' as const,
        stdout: { maxBytes: VscodeTools.GIT_STDOUT_MAX_BYTES },
        stderr: { maxBytes: VscodeTools.GIT_STDERR_MAX_BYTES },
      },
      graceMs: 5000,
      signal,
    }
    let handle: import('@deepseek-ai/dsh-subprocess').SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn(spec as never)
    } catch {
      throw new RemoteError('vscode-tools/git-failed', 'git command could not start', {})
    }
    let outcome: import('@deepseek-ai/dsh-subprocess').SubprocessOutcome
    // Race the process against a hard deadline. `terminate()` is best-effort:
    // an unkillable process must still not hang the caller, so the timeout
    // path reports a timeout error while the kill completes in the background.
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve(handle.terminate?.()).catch(() => undefined)
        reject(new RemoteError('vscode-tools/git-timeout', `git ${argv[0] ?? ''} did not finish within ${VscodeTools.GIT_TIMEOUT_MS} ms`, {}))
      }, VscodeTools.GIT_TIMEOUT_MS)
    })
    try {
      outcome = await Promise.race([handle.done, timeout])
    } catch (err) {
      if (err instanceof RemoteError) throw err
      if (signal?.aborted === true) {
        throw new RemoteError('vscode-tools/aborted', 'git command was cancelled', {})
      }
      throw new RemoteError('vscode-tools/git-failed', 'git process failed before reporting an outcome', {})
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout === undefined) throw new RemoteError('vscode-tools/git-failed', 'git produced no collected stdout', {})
    const stderrText = stderr?.text ?? ''
    if (outcome.exitCode === 128 && /not a git repository/i.test(stderrText)) {
      throw new RemoteError('vscode-tools/not-a-repo', 'the workspace root is not a git repository', {})
    }
    if (outcome.signal !== null || outcome.exitCode === null) {
      throw new RemoteError('vscode-tools/git-failed', 'git was killed by signal ' + (outcome.signal ?? '(unknown)'), {})
    }
    if (outcome.exitCode !== 0) {
      const detail = stderrText.trim().length > 0 ? stderrText.trim() : stdout.text.trim().slice(-2000)
      throw new RemoteError('vscode-tools/git-failed', 'git exited with code ' + outcome.exitCode + ': ' + detail, {})
    }
    return stdout.text
  }

  /** Cap a unified diff for the prompt: keep whole per-file sections while
   *  the byte budget lasts (so no file is cut mid-hunk), then note how many
   *  files were omitted. A single oversized section (e.g. a rebuilt bundle)
   *  keeps its head at the budget. */
  private truncateDiffForPrompt(diff: string, maxBytes: number): string {
    if (diff.length <= maxBytes) return diff
    const sections: string[] = []
    let current: string[] = []
    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git ') && current.length > 0) {
        sections.push(current.join('\n'))
        current = [line]
      } else {
        current.push(line)
      }
    }
    if (current.length > 0) sections.push(current.join('\n'))

    let kept = ''
    let omitted = 0
    for (const section of sections) {
      if (kept.length === 0 && section.length > maxBytes) {
        kept = section.slice(0, maxBytes) + '\n… (file diff truncated)'
        omitted = sections.length - 1
        break
      }
      if (kept.length + section.length > maxBytes) { omitted += 1; continue }
      kept = kept.length === 0 ? section : kept + '\n' + section
    }
    return kept + (omitted > 0 ? '\n… (' + omitted + ' more file diff(s) omitted)' : '')
  }

  /** Clean model output: strip markdown fences and commit-message label
   *  lines and signature lines, collapse runs of blank lines, trim. */
  private sanitizeCommitMessage(raw: string): string {
    let text = raw.trim()
    const label = /^\s*(?:suggested commit message|commit message|提交信息|提交消息)\s*[:：]\s*/i
    text = text.replace(label, '')
    // Strip one wrapping markdown fence, optionally language-tagged.
    if (text.startsWith('\x60\x60\x60')) {
      const firstNl = text.indexOf('\n')
      const lastFence = text.lastIndexOf('\x60\x60\x60')
      if (firstNl > 0 && lastFence > firstNl) text = text.slice(firstNl + 1, lastFence)
    }
    text = text.replace(label, '')
    // Drop model signature lines (Generated with …).
    text = text.split('\n').filter((line) => !/generated\s+(with|by)\b/i.test(line)).join('\n')
    // Collapse runs of blank lines to one blank line.
    text = text.replace(/\n{3,}/g, '\n\n').trim()
    return text
  }

  // ---------- AI bridge (localhost HTTP for the VS Code extension) ----------

  /** Start the localhost AI bridge for one Session's code-server. Returns
   *  null when no port could be bound (the extension then shows its
   *  unavailable hint; everything else keeps working). */
  private startBridge(sessionId: string): Promise<{ server: Server; port: number } | null> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        void this.handleBridgeRequest(sessionId, req, res).catch((err) => {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        })
      })
      server.once('error', () => resolve(null))
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') { server.close(); resolve(null); return }
        resolve({ server, port: addr.port })
      })
    })
  }

  /** One POST /commit-message {workspaceRoot} → {message}. Loopback only. */
  private async handleBridgeRequest(sessionId: string, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || (req.url ?? '').startsWith('/commit-message') !== true) {
      send(404, { error: 'not found' })
      return
    }
    // Read the (bounded) JSON body.
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > 1024 * 1024) { send(413, { error: 'body too large' }); return }
      chunks.push(chunk as Buffer)
    }
    let parsed: { workspaceRoot?: unknown }
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { error: 'invalid JSON body' })
      return
    }
    if (typeof parsed.workspaceRoot !== 'string' || parsed.workspaceRoot.length === 0) {
      send(400, { error: 'workspaceRoot is required' })
      return
    }
    // The bridge serves the ONE Session whose code-server child received its
    // URL: refuse any other workspace the DSH host happens to be serving.
    const server = this.vscodeServers.get(sessionId)
    if (server === undefined) { send(503, { error: 'bridge is shutting down' }); return }
    try {
      const result = await this.generateCommitMessage(
        { sessionId, workspaceRoot: parsed.workspaceRoot },
        undefined,
      )
      send(200, result)
    } catch (err) {
      const code = err instanceof RemoteError ? err.code : 'vscode-tools/bridge-failed'
      const message = err instanceof Error ? err.message : String(err)
      send(500, { error: message, code })
    }
  }

  // ---------- bundled extension install ----------

  /** Copy the bundled dsh-ai-commit extension into the shared extensions dir.
   *  Idempotent: skipped when the installed copy already matches this build's
   *  extension.js (cheap content hash). The dir is shared with dsh-web-ide's
   *  code-server instances, which simply ignore the extra extension. */
  private async installBundledExtension(extensionsDir: string): Promise<void> {
    try {
      // lib/vscode-extension ships inside this package (tsdown copies it via
      // the build script; see scripts/copy-extension.mjs). This bundle is ESM:
      // __dirname does not exist — resolve from import.meta.url instead.
      const srcDir = join(dirname(fileURLToPath(import.meta.url)), 'vscode-extension')
      if (!existsSync(join(srcDir, 'extension.js'))) return
      const dstDir = join(extensionsDir, 'dsh-ai-commit')
      await mkdir(dstDir, { recursive: true })
      const srcJs = await readFile(join(srcDir, 'extension.js'), 'utf8')
      const dstJsPath = join(dstDir, 'extension.js')
      const dstJs = existsSync(dstJsPath) ? await readFile(dstJsPath, 'utf8') : ''
      if (dstJs !== srcJs) await writeFile(dstJsPath, srcJs)
      const srcPkg = await readFile(join(srcDir, 'package.json'), 'utf8')
      const dstPkgPath = join(dstDir, 'package.json')
      const dstPkg = existsSync(dstPkgPath) ? await readFile(dstPkgPath, 'utf8') : ''
      if (dstPkg !== srcPkg) await writeFile(dstPkgPath, srcPkg)
      // Keep the extensions.json manifest entry present and current: the
      // workbench's Extensions view reads this listing, and a user clicking
      // "Remove Extension" there deletes the entry (the folder survives).
      // Re-registering here self-heals such a removal on the next VS Code
      // tab open, and matches what `code-server --install-extension` writes.
      await this.registerExtensionManifestEntry(extensionsDir, dstDir, srcPkg)
    } catch (err) {
      console.warn('[ui-vscode] bundled extension install failed:', err instanceof Error ? err.message : String(err))
    }
  }

  /** Ensure extensions.json lists the bundled extension. Best effort: a
   *  malformed manifest is reset to a fresh list with just this entry. */
  private async registerExtensionManifestEntry(extensionsDir: string, extDir: string, pkgText: string): Promise<void> {
    try {
      const pkg = JSON.parse(pkgText) as { publisher?: string; name?: string; version?: string }
      const id = (pkg.publisher ?? 'zhaoyang10') + '.' + (pkg.name ?? 'dsh-ai-commit')
      const manifestPath = join(extensionsDir, 'extensions.json')
      let entries: Array<Record<string, unknown>> = []
      if (existsSync(manifestPath)) {
        try {
          const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
          if (Array.isArray(parsed)) entries = parsed as Array<Record<string, unknown>>
        } catch { /* malformed — start fresh */ }
      }
      const alreadyListed = entries.some((e) =>
        (e.identifier as { id?: string } | undefined)?.id?.toLowerCase() === id.toLowerCase())
      const isCurrent = alreadyListed && entries.some((e) =>
        (e.identifier as { id?: string } | undefined)?.id?.toLowerCase() === id.toLowerCase()
        && (e.version as string | undefined) === (pkg.version ?? '0.1.0'))
      if (isCurrent) return
      entries = entries.filter((e) =>
        (e.identifier as { id?: string } | undefined)?.id?.toLowerCase() !== id.toLowerCase())
      entries.push({
        identifier: { id },
        version: pkg.version ?? '0.1.0',
        location: { $mid: 1, fsPath: extDir, path: extDir, scheme: 'file' },
        // MUST be a string: the workbench's profile scanner validates every
        // entry with `isString(relativeLocation) || isUri(relativeLocation)`
        // (extensionsProfileScannerService). A null here raises
        // "Invalid extensions content in extensions.json", which aborts the
        // WHOLE user-extension scan on each attempt — 100 times on every page
        // load — and takes the builtin git extension down with it, so Source
        // Control shows no badge and no changed files.
        relativeLocation: basename(extDir),
        metadata: {
          id,
          publisherId: pkg.publisher ?? 'zhaoyang10',
          publisherDisplayName: pkg.publisher ?? 'zhaoyang10',
          // VS Code spells "no specific platform" as the string 'universal'.
          targetPlatform: 'universal',
          isApplicationScoped: false,
          isPreReleaseVersion: false,
          hasPreReleaseVersion: false,
          installedTimestamp: Date.now(),
          pinned: false,
          preRelease: false,
        },
      })
      await writeFile(manifestPath, JSON.stringify(entries))
    } catch (err) {
      console.warn('[ui-vscode] extension manifest registration failed:', err instanceof Error ? err.message : String(err))
    }
  }

  private stopBridge(sessionId: string): void {
    const server = this.vscodeServers.get(sessionId)
    if (server?.bridge !== undefined) {
      server.bridge.server.close()
      server.bridge = undefined
    }
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
    this.stopBridge(sessionId)
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
      server.bridge?.server.close()
      try { await Promise.resolve(server.handle.terminate?.()) } catch { /* already gone */ }
    }))
  }
}

export default VscodeTools
