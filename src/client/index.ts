/**
 * Client entry for the VS Code plugin: register the `vscode` view tab into
 * the conversation view ring, right AFTER the chat tab (chat order 0, this
 * order 1, so it sits between chat and trajectory), AND as a right-sidebar
 * tab (like dsh-web-ide). Both bodies land directly in the embedded VS Code
 * (code-server) workbench — the default page this plugin exists for.
 *
 * The registrations ride the slot service's effect wrapper, so plugin unload
 * removes the tabs. Ported from dsh-web-ide's client/index.ts, minus every
 * Monaco/terminal/git feature.
 */
import type { VscodeClientContext, VscodeToolsRemote, VscodeViewInjected } from './types.js'
import { VscodeView } from './VscodeView.js'
import { TYPERT_REMOTE } from '../typert.remote-client.js'
import { NS, zh, en } from './locales.js'
import { VSCODE_STYLES } from './theme.js'
import React, { useEffect, useRef } from 'react'

/** Inject the runtime stylesheet once per page. */
function installStyles(): void {
  if (document.querySelector('style[data-dsh-vscode]') !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-vscode', '')
  style.textContent = VSCODE_STYLES
  ;(document.head ?? document.documentElement).appendChild(style)
}

/** Auto-fullscreen the DSH right-sidebar panel that hosts this tab's body.
 *  Mirrors dsh-code-server-app's requestFullscreenPanel: find the enclosing
 *  [data-sidebar-right-panel] and click its [data-sidebar-right-mode="fullscreen"]
 *  chrome button (the same path as a user clicking fullscreen). Already-fullscreen
 *  panels have no such button → returns 'no-control' silently. */
function requestFullscreenPanel(rootEl: HTMLElement | null): string {
  if (rootEl == null || typeof rootEl.closest !== 'function') return 'no-root'
  let panel: Element | null
  let control: HTMLElement | null
  try {
    panel = rootEl.closest('[data-sidebar-right-panel]')
    if (panel == null || typeof panel.querySelector !== 'function') return 'no-panel'
    control = panel.querySelector('[data-sidebar-right-mode="fullscreen"]') as HTMLElement | null
  } catch { return 'lookup-failed' }
  if (control == null || typeof control.click !== 'function') return 'no-control'
  try { control.click() } catch { return 'click-failed' }
  return 'clicked'
}

/** Minimal shape of DSH's SidebarRightTabInfo consumed here. The full type
 *  lives in @deepseek-ai/dsh-client-ui-sidebar-right's contract/slots.ts; we
 *  redeclare only what the auto-fullscreen logic reads, so this bundle keeps no
 *  runtime dependency on that package's type tree. */
interface VscodeTabInfo {
  sidebar: { fullscreen: boolean }
  panel: { id: string }
  tab: {
    visible: boolean
    id: string
    actions: { close(): void }
  }
}

/** Stable, module-level wrapper around VscodeView that drives the sidebar
 *  tab's auto-fullscreen. MUST live at module scope (not re-created inside
 *  the register callback): a function component defined inline in the
 *  callback is a fresh function reference on every render, which makes React
 *  treat it as a different element type and unmount/remount the whole subtree
 *  on each store commit — wiping the refs, so the false→true "visible"
 *  transition would never be observed and the panel would never
 *  auto-fullscreen.
 *
 *  Selection signal: the body props do NOT carry per-tab "active"/"fullscreen"
 *  directly — TabSlot passes those inside hookContext, which only feeds the
 *  slot-declared hook factories. The readable per-tab signal is the
 *  slot-injected useTabInfo prop (standardHookPropName of the slot's declared
 *  hooks.tabInfo): useTabInfo().tab.visible is TRUE only while this tab is
 *  the active tab of a visible pane (pane.activeTabId === tabId && expanded),
 *  so a false→true transition is exactly "the user switched to this tab". */
const VscodeSidebarTab = React.memo(function VscodeSidebarTab(props: {
  useTabInfo: () => VscodeTabInfo
  viewProps: VscodeViewInjected
}) {
  const { useTabInfo, viewProps } = props
  const info = useTabInfo()
  const visible = info.tab.visible === true
  const fullscreen = info.sidebar.fullscreen === true
  const ref = useRef<HTMLDivElement>(null)
  // One-shot latch per visible episode: set when this body has already put the
  // panel into fullscreen for the CURRENT visibility stretch, cleared when the
  // tab leaves visibility — so the next entry (re-click, sidebar reopen) can
  // trigger again. Without it, "mount already fullscreen → user exits
  // fullscreen" would immediately re-trigger (fullscreen prop flips false while
  // visible stays true) and yank the user back.
  const forcedRef = useRef(false)
  React.useLayoutEffect(() => {
    if (!visible) { forcedRef.current = false; return }
    // Already fullscreen, or this visibility episode already forced it once.
    if (fullscreen || forcedRef.current) return
    forcedRef.current = true
    requestFullscreenPanel(ref.current)
  }, [visible, fullscreen])

  // Pass per-tab visibility down: DSH HIDES an inactive tab's body instead of
  // unmounting it, so the iframe should not react to tab switches — but keep
  // the prop flowing for future use (e.g. terminal focus) in exact parity
  // with dsh-web-ide's IdeSidebarTab.
  const visibleProps: VscodeViewInjected = viewProps.tabVisible === visible ? viewProps : { ...viewProps, tabVisible: visible }
  return React.createElement('div', {
    ref,
    'data-vscode-sidebar-tab': '',
    style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const },
  }, React.createElement(VscodeView, visibleProps))
})
VscodeSidebarTab.displayName = 'VscodeSidebarTab'

/** Required browser services: slots, sessions, locale, and the Remote
 *  service. The vscodeTools namespace is deliberately ABSENT: this bundle
 *  mounts it itself inside apply(), so pre-resolving it here would deadlock
 *  the boot. */
const inject = [
  'slots',
  'sessions',
  'locale',
  'remote',
  'remote.workspaceFiles',
  'sidebarRightTabs',
  'sidebarRight',
] as const

export { inject }

/** Degraded vscodeTools face used before the namespace finishes mounting (or
 *  after it failed to mount): every call reports the degraded state instead of
 *  throwing, so the view stays usable. */
const stubVscodeTools = {
  vscodeOpen: async () => ({ ok: false as const, error: { code: 'vscode-tools/unavailable', message: 'vscodeTools namespace is not mounted yet' } }),
  vscodeStatus: async () => ({ ok: false as const, error: { code: 'vscode-tools/unavailable', message: 'vscodeTools namespace is not mounted yet' } }),
  vscodeStop: async () => ({ ok: false as const, error: { code: 'vscode-tools/unavailable', message: 'vscodeTools namespace is not mounted yet' } }),
} as unknown as VscodeToolsRemote

/** Client plugin body: fire-and-forget the vscodeTools Remote namespace
 *  mount, then synchronously register the view tab. We must NOT await the
 *  $mount here — the gateway's mutation-queue / effect-wrapper does not settle
 *  inside an async apply that the browser boot kernel is itself gating on, so
 *  awaiting it deadlocks apply. The namespace comes up on the remote service's
 *  own fiber independently; the view reads the namespace lazily at render
 *  time (via a getter with a stub fallback), by which point it has settled. */
export async function apply(ctx: VscodeClientContext) {
  const mountPromise = ctx.remote.$mount(TYPERT_REMOTE).catch((mountError: unknown) => {
    console.error('[ui-vscode] vscodeTools $mount failed:', mountError)
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-vscode: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    installStyles()
    return () => { /* the style node stays; plugin reload reuses it */ }
  }, 'ui-vscode: styles')

  /** Lazy reader for this bundle's own vscodeTools namespace. The namespace
   * is mounted on the Remote service's internal namespaces Map by the
   * fire-and-forget $mount above; reading ctx.remote.vscodeTools would require
   * listing 'remote.vscodeTools' in inject — but this bundle mounts it itself,
   * so pre-resolving it in inject deadlocks the boot. Instead, reach into the
   * Remote service's own namespaces Map (ctx.remote is injected, its plain
   * properties are not inject-gated) and grab the namespace service. Until it
   * settles the call lands on the stub, which reports the degraded state
   * instead of throwing. */
  const vscodeToolsFace = (): VscodeToolsRemote => {
    const remote = ctx.remote as unknown as {
      namespaces?: Map<string, { service: unknown }>
    }
    const ns = remote.namespaces?.get('vscodeTools')?.service as VscodeToolsRemote | undefined
    return ns ?? stubVscodeTools
  }

  /** Props shared by both tab bodies. */
  const viewPropsFor = (sessionId: string | undefined): VscodeViewInjected => {
    const sessions = ctx.sessions.list.getSnapshot()
    const cwd = sessionId !== undefined ? sessions.byId[sessionId]?.cwd : undefined
    return {
      sessionId,
      cwd,
      vscodeTools: vscodeToolsFace(),
      t,
    }
  }

  // ---------- conversation.view tab (right after the chat tab) ----------
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'vscode',
        order: 1,
        locale: NS,
        label: () => t('view.vscode'),
        inject: (sessionId: string): VscodeViewInjected => viewPropsFor(sessionId),
      },
      (props: unknown) => {
        const injected = (props ?? {}) as VscodeViewInjected
        return VscodeView(injected)
      },
    ),
  )

  // ---------- DSH right-sidebar VS Code tab ----------
  // Two-phase: tab TYPE into sidebarRightTabs, BODY into the keyed slot
  // sidebar.right.pane.tab.
  const VSCODE_TAB_ID = 'dsh-web-vscode'
  const VSCODE_KIND = 'vscode'
  if (ctx.sidebarRightTabs) {
    ctx.effect(() => {
      return ctx.sidebarRightTabs!.register({
        id: VSCODE_TAB_ID,
        kind: VSCODE_KIND,
        priority: 'extension',
        patterns: [],
        keepMounted: true,
        title: () => t('view.vscode'),
        guide: [{
          order: 21,
          title: () => t('view.vscode'),
          description: () => t('view.vscodeGuide'),
        }],
      })
    }, 'ui-vscode: sidebar tab type')

    ctx.effect(() => {
      return ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: VSCODE_TAB_ID },
          (props: unknown) => {
            // The slot runtime composes body props as {...kit, ...injected,
            // ...slotInjected.props, ...contextual, ...ownerProps}. For this
            // slot the contextual share carries useTabInfo — the slot-declared
            // hooks.tabInfo factory bound to this tab's hookContext. It is the
            // ONLY per-tab selection signal a body receives: hookContext itself
            // (active/fullscreen) stays inside the runtime and never reaches
            // these props. useTabInfo().tab.visible is true exactly while this
            // tab is the active tab of a visible pane.
            const tabProps = (props ?? {}) as {
              sessionId?: string
              useTabInfo?: () => VscodeTabInfo
            }
            const sessionId = tabProps.sessionId ?? ctx.sessions.list.getSnapshot().current ?? ''
            const viewProps = viewPropsFor(sessionId)
            const useTabInfo = tabProps.useTabInfo
            if (typeof useTabInfo !== 'function') {
              // DSH version without the hook (or it failed to bind): render
              // without auto-fullscreen rather than crash the pane.
              return React.createElement('div', {
                'data-vscode-sidebar-tab': '',
                style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const },
              }, VscodeView(viewProps))
            }
            // Render the stable module-level VscodeSidebarTab (NOT an inline
            // function component — see the note on VscodeSidebarTab above) so
            // the subtree is reused across renders and the false→true "visible"
            // transition is observed instead of being wiped by remounts.
            return React.createElement(VscodeSidebarTab, { useTabInfo, viewProps })
          },
        ),
      )
    }, 'ui-vscode: sidebar tab body')
  }

  // Resolve the background mount when it settles and return a disposer that
  // unmounts the namespace on plugin unload.
  return async () => {
    const unmountRemote = await mountPromise
    if (typeof unmountRemote === 'function') await unmountRemote()
  }
}

// Keep React imported for consumers that import this module's React usage.
void React
void useEffect
