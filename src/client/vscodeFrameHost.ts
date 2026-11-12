/**
 * Persistent host for the code-server iframe — ported from dsh-web-ide's
 * vscodeFrameHost.ts.
 *
 * WHY: in DSH the VS Code tab's body is ordinary conditional React markup.
 * Switching to the chat tab (or to another right-sidebar tab) REMOVES the
 * <iframe> from the document, and a frame that leaves the document is
 * destroyed by the browser — so every switch back reloaded the whole
 * workbench from scratch (the user's "首次加载后又被重新加载" symptom).
 *
 * Two behaviours, verified in a real browser (dsh-web-ide):
 *  1. REPARENTING an iframe (appendChild elsewhere) RELOADS its document.
 *  2. display:none <-> visible does NOT reload it.
 *
 * So the frame is created ONCE inside a <body>-level container that never
 * leaves the document, sized as a position:fixed overlay whose rect is copied
 * from an anchor element rendered by React on every frame. A tab switch then
 * only hides the overlay (parked) instead of destroying the frame; coming back
 * re-paints the SAME live document — no reload. Only "Reload" / "Stop Server"
 * (or a different code-server URL) tears the frame down.
 */

/** Rect copied onto the fixed overlay container. */
export interface VscodeFrameRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

interface FrameState {
  container: HTMLDivElement
  frame: HTMLIFrameElement | null
  url: string | undefined
  /** Anchor currently driving the overlay (null = no VS Code view mounted). */
  anchor: HTMLElement | null
  raf: number
}

declare global {
  interface Window {
    __dshVscodeFrame?: FrameState
  }
}

const CONTAINER_CLASS = 'vscode-overlay'
const FRAME_CLASS = 'vscode-frame'
/** data-testid of the React-rendered anchor the overlay follows. */
export const ANCHOR_TESTID = 'vscode-anchor'
const ANCHOR_SELECTOR = '[data-testid="' + ANCHOR_TESTID + '"]'

function state(): FrameState {
  const w = window as Window
  if (w.__dshVscodeFrame === undefined) {
    const container = document.createElement('div')
    container.className = CONTAINER_CLASS
    container.setAttribute('data-hidden', 'true')
    // Must outlive every React subtree (a tab switch unmounts the body): the
    // container hangs off <body>, outside React's control.
    ;(document.body ?? document.documentElement).appendChild(container)
    w.__dshVscodeFrame = { container, frame: null, url: undefined, anchor: null, raf: 0 }
  }
  return w.__dshVscodeFrame
}

function ensureFrame(url: string): HTMLIFrameElement {
  const s = state()
  if (s.frame !== null && s.url === url) return s.frame
  // A different code-server instance (restarted, possibly on another port)
  // invalidates the old document; that is the only case that rebuilds the
  // frame besides an explicit reload.
  if (s.frame !== null) s.frame.remove()
  const frame = document.createElement('iframe')
  frame.className = FRAME_CLASS
  frame.title = 'VS Code'
  frame.setAttribute('data-testid', 'vscode-frame')
  frame.setAttribute('allow', 'clipboard-read; clipboard-write')
  frame.src = url
  s.container.appendChild(frame)
  s.frame = frame
  s.url = url
  return frame
}

function applyRect(rect: VscodeFrameRect): void {
  const c = state().container
  c.style.top = rect.top + 'px'
  c.style.left = rect.left + 'px'
  c.style.width = rect.width + 'px'
  c.style.height = rect.height + 'px'
}

function park(): void {
  const s = state()
  if (s.container.getAttribute('data-hidden') !== 'true') {
    s.container.setAttribute('data-hidden', 'true')
    // A fixed box left on screen keeps counting toward the document scroll
    // height; collapse it while parked.
    s.container.style.width = '0px'
    s.container.style.height = '0px'
  }
}

/**
 * Start following `anchor`: the overlay is positioned over it and shown as
 * soon as it has a non-zero box. Idempotent — calling it again re-points the
 * anchor (the loop is already running).
 */
export function showVscodeFrame(url: string, anchor: HTMLElement): void {
  const s = state()
  ensureFrame(url)
  s.anchor = anchor
  if (s.raf !== 0) return // loop already running; the new anchor is picked up
  let last = ''
  const tick = (): void => {
    const st = (window as Window).__dshVscodeFrame
    if (st === undefined) return
    // Re-resolve the anchor from the document on every frame. React keeps the
    // component instance across a tab switch while the host replaces its DOM,
    // so a reference captured once goes stale (isConnected === false) and the
    // overlay stays parked forever.
    const live = document.querySelector(ANCHOR_SELECTOR) as HTMLElement | null
    if (live !== null && live !== st.anchor) st.anchor = live
    const a = st.anchor
    if (a === null || !isAnchorVisible(a)) {
      // No anchor right now (the VS Code tab body is not mounted) or the body
      // is mounted but hidden (DSH switches views by unmounting, and the right
      // sidebar hides an inactive tab body with hidden/inert). Park the
      // overlay and keep ticking so the pane coming back needs no React
      // lifecycle hook to remember us.
      park()
      last = ''
      st.raf = requestAnimationFrame(tick)
      return
    }
    const r = a.getBoundingClientRect()
    // Never write an off-screen rect.
    const vh = window.innerHeight || document.documentElement.clientHeight
    const onScreen = r.top < vh && r.bottom > 0 && r.width > 0 && r.height > 0
    if (onScreen) {
      const key = Math.round(r.top) + ',' + Math.round(r.left) + ',' + Math.round(r.width) + ',' + Math.round(r.height)
      if (key !== last) {
        last = key
        applyRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
      if (st.container.getAttribute('data-hidden') !== 'false') {
        st.container.setAttribute('data-hidden', 'false')
        st.container.style.display = 'block'
      }
    } else {
      park()
    }
    st.raf = requestAnimationFrame(tick)
  }
  s.raf = requestAnimationFrame(tick)
}

/**
 * True when the anchor can actually be painted: connected, not inside a
 * display:none / visibility:hidden subtree, with a real on-screen box.
 * offsetParent alone is not enough — a hidden subtree still reports one.
 */
function isAnchorVisible(a: HTMLElement): boolean {
  if (!a.isConnected || a.offsetParent === null) return false
  if (a.closest('[hidden], [inert]') !== null) return false
  const r = a.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const vh = window.innerHeight || document.documentElement.clientHeight
  const vw = window.innerWidth || document.documentElement.clientWidth
  if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false
  return true
}

/**
 * Hide the overlay WITHOUT detaching the frame (tab inactive or view
 * unmounted). display:none keeps the loaded document — and its workbench
 * state — alive.
 */
export function parkVscodeFrame(): void {
  const s = (window as Window).__dshVscodeFrame
  if (s === undefined) return
  park()
  s.container.style.display = 'none'
}

/** Re-show a parked overlay with its existing anchor (frame document kept). */
export function reshowVscodeFrame(): void {
  const s = (window as Window).__dshVscodeFrame
  if (s === undefined || s.anchor === null || s.url === undefined) return
  showVscodeFrame(s.url, s.anchor)
}

/** Tear the frame down for real (Reload / Stop Server). */
export function destroyVscodeFrame(): void {
  const s = (window as Window).__dshVscodeFrame
  if (s === undefined) return
  s.frame?.remove()
  s.frame = null
  s.url = undefined
  // A real teardown: stop watching, so a stopped server is not revived by the
  // visibility loop.
  s.anchor = null
  if (s.raf !== 0) { cancelAnimationFrame(s.raf); s.raf = 0 }
  s.container.setAttribute('data-hidden', 'true')
  s.container.style.width = '0px'
  s.container.style.height = '0px'
}

/** True when a live frame already holds this URL (skip the loading pill). */
export function hasVscodeFrame(url: string): boolean {
  const s = (window as Window).__dshVscodeFrame
  return s !== undefined && s.frame !== null && s.url === url
}
