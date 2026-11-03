import { ReactNode } from "react";

//#region src/client/types.d.ts

/** Loose client context shaped by the boot kernel from the inject array. */
interface VscodeClientContext {
  effect(fn: () => unknown, name?: string): () => void;
  slots: {
    inject<T>(name: string, register: () => T): T;
    register(options: unknown, component: (props: unknown) => ReactNode): unknown;
  };
  sessions: {
    list: {
      getSnapshot(): {
        byId: Record<string, {
          cwd?: string;
        } | undefined>;
        current: string | undefined;
      };
    };
  };
  locale: {
    register(ns: string, dict: {
      zh: Record<string, string>;
      en: Record<string, string>;
    }): () => void;
    bind(ns: string): (key: string, params?: Record<string, string | number>) => string;
  };
  remote: {
    workspaceFiles: unknown;
    $mount(artifact: unknown): Promise<() => void>;
  };
  /** DSH right-sidebar tab type registry. */
  sidebarRightTabs?: {
    register(options: {
      id: string;
      kind: string;
      priority?: string;
      patterns?: string[];
      canOpen?: (address: string) => boolean;
      keepMounted?: boolean;
      title?: (address?: string) => string;
      guide?: {
        order: number;
        title: () => string;
        description: () => string;
        icon?: (props: {
          size?: number;
          className?: string;
        }) => ReactNode;
      }[];
    }): () => void;
  };
}
//#endregion
//#region src/client/index.d.ts
/** Required browser services: slots, sessions, locale, and the Remote
 *  service. The vscodeTools namespace is deliberately ABSENT: this bundle
 *  mounts it itself inside apply(), so pre-resolving it here would deadlock
 *  the boot. */
declare const inject: readonly ["slots", "sessions", "locale", "remote", "remote.workspaceFiles", "sidebarRightTabs", "sidebarRight"];
/** Client plugin body: fire-and-forget the vscodeTools Remote namespace
 *  mount, then synchronously register the view tab. We must NOT await the
 *  $mount here — the gateway's mutation-queue / effect-wrapper does not settle
 *  inside an async apply that the browser boot kernel is itself gating on, so
 *  awaiting it deadlocks apply. The namespace comes up on the remote service's
 *  own fiber independently; the view reads the namespace lazily at render
 *  time (via a getter with a stub fallback), by which point it has settled. */
declare function apply(ctx: VscodeClientContext): Promise<() => Promise<void>>;
//#endregion
export { apply, inject };