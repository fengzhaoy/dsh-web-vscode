/**
 * The VS Code view: a real code-server workbench in an iframe, plus a slim
 * toolbar (origin / reload / stop) ported from dsh-web-ide's VscodeTab.
 *
 * The view auto-OPENS the server on first mount (that is the whole point of
 * this plugin: clicking the tab lands directly in the workbench, exactly like
 * dsh-web-ide's left-bar VS Code icon) and keeps the server running across
 * tab switches and body unmounts — reopening is instant; only "Stop Server"
 * (or host shutdown) kills the process.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { VscodeInfo, VscodeViewInjected } from './types.js'

/** Minimal non-failing toast, so errors are visible even before the tab body
 *  exists. Uses the console plus an inline error state; the view is small
 *  enough not to warrant a notification system. */
function logError(message: string): void {
  console.error('[ui-vscode] ' + message)
}

export function VscodeView(props: VscodeViewInjected) {
  const { sessionId, vscodeTools, t } = props
  const [info, setInfo] = useState<VscodeInfo | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Guard so a failed auto-open does not loop: set once per session id. */
  const autoOpenedFor = useRef<string | undefined>(undefined)
  /** The in-flight open request, so a later manual retry can supersede it. */
  const openSeq = useRef(0)

  const openVscode = useCallback(async (restart = false) => {
    if (sessionId === undefined) {
      setError(t('vscode.noSession'))
      return
    }
    const seq = ++openSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await vscodeTools.vscodeOpen(sessionId, { restart })
      if (seq !== openSeq.current) return // superseded by a newer request
      if (!res.ok) {
        const message = res.error.code === 'vscode-tools/vscode-missing'
          ? t('vscode.notInstalled')
          : (res.error.message ?? res.error.code)
        setError(message)
        logError(message)
        return
      }
      setInfo(res.value)
    } catch (err) {
      if (seq !== openSeq.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      logError(message)
    } finally {
      if (seq === openSeq.current) setLoading(false)
    }
  }, [sessionId, vscodeTools, t])

  const stopVscode = useCallback(async () => {
    if (sessionId === undefined) return
    try { await vscodeTools.vscodeStop(sessionId) } catch { /* already gone */ }
    setInfo(undefined)
  }, [sessionId, vscodeTools])

  // Auto-open on first mount for this session (the tab's default landing
  // state IS the workbench). Not re-triggered on tab switches: the server
  // keeps running and the iframe stays mounted (keepMounted), so a re-entry
  // just reveals the live workbench again.
  useEffect(() => {
    if (sessionId === undefined) return
    if (autoOpenedFor.current === sessionId) return
    autoOpenedFor.current = sessionId
    void openVscode()
  }, [sessionId, openVscode])

  return (
    <div className="vscode-shell" data-testid="vscode-shell">
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
      {error !== null && (
        <div className="vscode-error" data-testid="vscode-error">
          <div>{error}</div>
          <button className="vscode-action" onClick={() => { void openVscode(true) }}>{t('vscode.retry')}</button>
        </div>
      )}
      {loading && <div className="vscode-loading" data-testid="vscode-loading">{t('vscode.starting')}</div>}
      {info !== undefined && error === null && (
        <iframe
          className="vscode-frame"
          src={info.url}
          title={t('vscode.title')}
          data-testid="vscode-frame"
          // The workbench needs its own storage/cookies; the host already binds
          // to loopback, so no sandbox token is required beyond same-origin.
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  )
}
