/**
 * The VS Code view: a real code-server workbench in an iframe, plus a slim
 * toolbar (origin / reload / stop), ported from dsh-web-ide's VscodeTab.
 *
 * The view auto-OPENS the server on first mount (that is the whole point of
 * this plugin: clicking the tab lands directly in the workbench) and keeps
 * the server running across tab switches and body unmounts — reopening is
 * instant; only "Stop Server" (or host shutdown) kills the process.
 *
 * The <iframe> itself does NOT live in this component's React tree. DSH
 * unmounts an inactive conversation view's body, and a frame removed from the
 * document is destroyed by the browser (the whole workbench then reloads on
 * every switch back). So the frame lives in vscodeFrameHost's body-level,
 * position:fixed overlay: this component renders only the toolbar plus an
 * anchor div, and the overlay follows that anchor. A tab switch hides the
 * overlay (parked) and keeps the live document; coming back re-paints it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { VscodeInfo, VscodePaneError, VscodeViewInjected } from './types.js'
import { ANCHOR_TESTID, destroyVscodeFrame, hasVscodeFrame, parkVscodeFrame, showVscodeFrame } from './vscodeFrameHost.js'

/** Minimal non-failing toast, so errors are visible even before the tab body
 *  exists. Uses the console plus an inline error state; the view is small
 *  enough not to warrant a notification system. */
function logError(message: string): void {
  console.error('[ui-vscode] ' + message)
}

/** Copy helper that also works on plain-http origins (no async clipboard). */
function copyText(text: string): void {
  try {
    void navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    try { document.execCommand('copy') } catch { /* best effort */ }
    document.body.removeChild(el)
  }
}

/** One install command with a copy button (dsh-web-ide's InstallRow). */
function InstallRow(props: {
  command: string
  note?: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const { command, note, t } = props
  const [copied, setCopied] = useState(false)
  return (
    <div className="vscode-install-row">
      <code className="vscode-install-cmd">{command}</code>
      <button
        className="vscode-action"
        aria-label={t('vscode.missing.copyCommand', { command })}
        onClick={() => {
          copyText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        data-testid="vscode-copy-command"
      >
        {copied ? t('vscode.copied') : t('vscode.copy')}
      </button>
      {note !== undefined && <span className="vscode-install-note">{note}</span>}
    </div>
  )
}

/** Install guide shown when code-server is not on this machine: what was
 *  missing, where the host looked, how to install, and a retry button. */
function MissingPanel(props: {
  searchedPaths: readonly string[]
  platform: string
  onRetry: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const { searchedPaths, platform, onRetry, t } = props
  const isMac = platform === 'darwin'
  const isWin = platform === 'win32'
  return (
    <div className="vscode-guide" data-testid="vscode-missing-guide">
      <div className="vscode-guide-title">{t('vscode.missing.title')}</div>
      <p className="vscode-guide-reason">{t('vscode.missing.reason')}</p>
      {searchedPaths.length > 0 && (
        <details className="vscode-guide-paths">
          <summary>{t('vscode.missing.searchedPaths')}</summary>
          <ul>
            {searchedPaths.slice(0, 12).map((p) => <li key={p}><code>{p}</code></li>)}
          </ul>
        </details>
      )}
      <div className="vscode-guide-subtitle">{t('vscode.missing.install')}</div>
      {isMac && <InstallRow command="brew install code-server" note={t('vscode.missing.recommended')} t={t} />}
      {!isWin && <InstallRow command="npm install -g code-server" note="https://github.com/coder/code-server" t={t} />}
      {isWin && <InstallRow command="npm install -g code-server" t={t} />}
      <p className="vscode-guide-hint">{t('vscode.missing.afterInstall')}</p>
      <p className="vscode-guide-hint">
        {t('vscode.missing.pathHint')} <code>DSH_IDE_VSCODE_BIN=/path/to/code-server</code>
      </p>
      <button className="vscode-action vscode-guide-retry" onClick={onRetry} data-testid="vscode-missing-retry">
        {t('vscode.retry')}
      </button>
    </div>
  )
}

export function VscodeView(props: VscodeViewInjected) {
  const { sessionId, vscodeTools, t } = props
  const [info, setInfo] = useState<VscodeInfo | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<VscodePaneError | null>(null)
  /** The anchor div the persistent overlay is positioned over. */
  const anchorRef = useRef<HTMLDivElement | null>(null)
  /** Last URL this view handed to the frame host (compared on every render). */
  const shownUrl = useRef<string | undefined>(undefined)

  /** Mount (or re-focus) the persistent overlay for `url`. Idempotent: a
   *  frame that already holds this URL is reused as-is. */
  const mountFrame = useCallback((url: string) => {
    shownUrl.current = url
    const anchor = anchorRef.current
    if (anchor !== null) showVscodeFrame(url, anchor)
  }, [])

  const openVscode = useCallback(async (restart = false) => {
    if (sessionId === undefined) {
      setError({ kind: 'start', message: t('vscode.noSession') })
      return
    }
    // An explicit restart invalidates the live document; drop it first so the
    // next frame is created fresh instead of showing the stopped workbench.
    if (restart) destroyVscodeFrame()
    // Adopt a workbench that is already alive BEFORE awaiting the host: the
    // server survives tab switches, so a re-entry must not wait on the round
    // trip (and must never show a "starting" pill over a loaded workbench).
    const sessionUrl = resolveSessionUrl(sessionId)
    if (sessionUrl !== undefined && hasVscodeFrame(sessionUrl)) mountFrame(sessionUrl)
    setLoading(true)
    setError(null)
    try {
      const res = await vscodeTools.vscodeOpen(sessionId, { restart })
      if (!res.ok) {
        // A missing binary is a setup state, not a failure: show how to install
        // it, with the paths this Host actually probed. Anything else (spawn
        // failure, timeout) is a plain error box.
        if (res.error.code === 'vscode-tools/vscode-missing') {
          const details = res.error.details ?? {}
          const paths = Array.isArray(details['searchedPaths'])
            ? (details['searchedPaths'] as unknown[]).filter((p): p is string => typeof p === 'string')
            : []
          const platform = typeof details['platform'] === 'string' ? details['platform'] : ''
          setError({ kind: 'missing', searchedPaths: paths, platform })
          logError(t('vscode.notInstalled'))
          return
        }
        const message = res.error.message !== '' ? res.error.message : res.error.code
        setError({ kind: 'start', message })
        logError(message)
        return
      }
      rememberSessionUrl(sessionId, res.value.url)
      setInfo(res.value)
      mountFrame(res.value.url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError({ kind: 'start', message })
      logError(message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, vscodeTools, t, mountFrame])

  const stopVscode = useCallback(async () => {
    if (sessionId === undefined) return
    destroyVscodeFrame()
    shownUrl.current = undefined
    forgetSessionUrl(sessionId)
    try { await vscodeTools.vscodeStop(sessionId) } catch { /* already gone */ }
    setInfo(undefined)
  }, [sessionId, vscodeTools])

  // First mount for this session: adopt the live workbench if the server is
  // still up (the tab body was unmounted by a tab switch, the server was
  // not), otherwise auto-open. Runs once per mount, which is exactly once per
  // tab activation — the frame itself survives the unmount.
  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    void (async () => {
      const cached = resolveSessionUrl(sessionId)
      if (cached !== undefined && hasVscodeFrame(cached)) {
        // Already loaded: show it immediately, then confirm the server is
        // still answering WITHOUT rebuilding the frame.
        setInfo({ url: cached, port: 0, ready: true })
        mountFrame(cached)
        try {
          const res = await vscodeTools.vscodeStatus(sessionId)
          if (cancelled) return
          if (res.ok && res.value !== null && res.value.url !== cached) {
            rememberSessionUrl(sessionId, res.value.url)
            setInfo(res.value)
            mountFrame(res.value.url)
          } else if (!res.ok || res.value === null) {
            // Server died while the body was unmounted: start a new one.
            await openVscode()
          }
        } catch { /* keep showing the live frame */ }
        return
      }
      await openVscode()
    })()
    return () => { cancelled = true }
  }, [sessionId, vscodeTools, openVscode, mountFrame])

  // Re-point the overlay at this mount's anchor and repaint it. Runs after
  // every render but is a no-op unless the URL changed or was lost.
  useEffect(() => {
    const url = info?.url ?? shownUrl.current
    if (url === undefined || anchorRef.current === null) return
    if (shownUrl.current !== url || !hasVscodeFrame(url)) mountFrame(url)
  })

  // Leaving the tab unmounts this body: park the overlay (hide only) so the
  // loaded workbench stays alive for the next entry. The anchor stays parked
  // until a new mount re-points it.
  useEffect(() => () => { parkVscodeFrame() }, [])

  const alreadyLoaded = info !== undefined && hasVscodeFrame(info.url)

  return (
    <div className="vscode-shell" data-testid="vscode-shell" data-vscode-view="">
      <div className="vscode-bar">
        <span className="vscode-title">{t('vscode.title')}</span>
        {info !== undefined && (
          <span className="vscode-origin" title={info.url}>{info.url}</span>
        )}
        <span className="vscode-actions">
          <button className="vscode-action" onClick={() => { void openVscode(true) }} data-testid="vscode-retry">{t('vscode.reload')}</button>
          <button className="vscode-action" onClick={() => { void stopVscode() }} data-testid="vscode-stop">{t('vscode.stop')}</button>
        </span>
      </div>
      {error !== null && error.kind === 'missing' && (
        <MissingPanel
          searchedPaths={error.searchedPaths}
          platform={error.platform}
          onRetry={() => { void openVscode(true) }}
          t={t}
        />
      )}
      {error !== null && error.kind === 'start' && (
        <div className="vscode-error" data-testid="vscode-error">
          <div>{error.message}</div>
          <button className="vscode-action" onClick={() => { void openVscode(true) }}>{t('vscode.retry')}</button>
        </div>
      )}
      {/* Only the "starting" pill is shown for a FIRST load; a frame that is
          already alive is re-shown instantly and must not flash a spinner. */}
      {loading && !alreadyLoaded && error === null && <div className="vscode-loading" data-testid="vscode-loading">{t('vscode.starting')}</div>}
      {/* The fixed overlay is positioned over this anchor; it holds no
          children of its own. */}
      <div className="vscode-anchor" ref={anchorRef} data-testid={ANCHOR_TESTID} />
    </div>
  )
}

// ---------- per-session URL memory ----------
// The frame host keeps the loaded document, but the URL belongs to the
// session: remember it so a remounted body can adopt the live frame without a
// host round trip. A module-level Map is enough — it lives as long as the
// plugin bundle, exactly like the frame.
const sessionUrls = new Map<string, string>()

function rememberSessionUrl(sessionId: string, url: string): void {
  sessionUrls.set(sessionId, url)
}

function forgetSessionUrl(sessionId: string): void {
  sessionUrls.delete(sessionId)
}

/** Test hook: the URL the frame host last adopted for this session. */
export function peekSessionUrl(sessionId: string): string | undefined {
  return sessionUrls.get(sessionId)
}

function resolveSessionUrl(sessionId: string): string | undefined {
  return sessionUrls.get(sessionId)
}