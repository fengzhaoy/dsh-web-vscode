/**
 * Declaration-merge this plugin's Remote failure vocabulary into the typert
 * protocol's extensible RemoteErrorDetailsMap (same pattern as
 * dsh-web-ide's src/remote-errors.d.ts). DSH 0.2.0 narrowed RemoteError's
 * code argument to keyof RemoteErrorDetailsMap, so every owner declares its
 * own domain codes next to the throwing code. Type-only: no runtime.
 */
import '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** code-server is not installed on this machine. */
    'vscode-tools/vscode-missing': { readonly [key: string]: unknown }
    /** code-server never answered on its port. */
    'vscode-tools/vscode-timeout': { readonly [key: string]: unknown }
    /** No Session workspace root is available for the call. */
    'vscode-tools/no-workspace': { readonly [key: string]: unknown }
  }
}
