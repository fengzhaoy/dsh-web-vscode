/**
 * Runtime types for the VS Code view. The host context `ctx` is loosely
 * typed here (matching the trajectory plugin convention): the `inject` array
 * names the services the boot kernel resolves before calling `apply`, and
 * the kernel shapes `ctx` accordingly. We type only what we touch.
 */
import type { ReactNode } from 'react'

/** Session identifiers are opaque strings on the wire. */
export type SessionId = string

/** Result shape of a Remote call: ok/value or an error. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** A running code-server instance. */
export interface VscodeInfo {
  /** Full iframe URL opening the workspace. */
  readonly url: string
  readonly port: number
  /** True once the workbench is serving. */
  readonly ready: boolean
}

/** The vscodeTools Remote face (self-mounted by this package's client bundle). */
export interface VscodeToolsRemote {
  /** Start or reuse a code-server for this workspace. */
  vscodeOpen(sessionId: SessionId, spec: { restart?: boolean }, signal?: AbortSignal): Promise<RemoteResult<VscodeInfo>>
  /** Current code-server state, or null when none is running. */
  vscodeStatus(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<VscodeInfo | null>>
  /** Stop the code-server for this Session. */
  vscodeStop(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<void>>
}

/** Props injected into the VS Code view. */
export interface VscodeViewInjected {
  readonly sessionId: string | undefined
  readonly cwd: string | undefined
  readonly vscodeTools: VscodeToolsRemote
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** True while this tab is the active tab of a VISIBLE pane
   *  (useTabInfo().tab.visible). DSH hides an inactive tab's body instead of
   *  unmounting it. Undefined when the host exposes no tabInfo hook. */
  readonly tabVisible?: boolean
}

/** Loose client context shaped by the boot kernel from the inject array. */
export interface VscodeClientContext {
  effect(fn: () => unknown, name?: string): () => void
  slots: {
    inject<T>(name: string, register: () => T): T
    register(options: unknown, component: (props: unknown) => ReactNode): unknown
  }
  sessions: {
    list: {
      getSnapshot(): {
        byId: Record<string, { cwd?: string } | undefined>
        current: string | undefined
      }
    }
  }
  locale: {
    register(ns: string, dict: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string, params?: Record<string, string | number>) => string
  }
  remote: {
    workspaceFiles: unknown
    $mount(artifact: unknown): Promise<() => void>
  }
  /** DSH right-sidebar tab type registry. */
  sidebarRightTabs?: {
    register(options: {
      id: string
      kind: string
      priority?: string
      patterns?: string[]
      canOpen?: (address: string) => boolean
      keepMounted?: boolean
      title?: (address?: string) => string
      guide?: { order: number; title: () => string; description: () => string; icon?: (props: { size?: number; className?: string }) => ReactNode }[]
    }): () => void
  }
}
