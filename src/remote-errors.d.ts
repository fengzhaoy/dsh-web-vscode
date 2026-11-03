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
    /** The workspace is not a git repository. */
    'vscode-tools/not-a-repo': { readonly [key: string]: unknown }
    /** No uncommitted changes to generate a message from. */
    'vscode-tools/no-changes': { readonly [key: string]: unknown }
    /** A git plumbing command failed. */
    'vscode-tools/git-failed': { readonly [key: string]: unknown }
    /** A git plumbing command timed out. */
    'vscode-tools/git-timeout': { readonly [key: string]: unknown }
    /** The call was cancelled by the client. */
    'vscode-tools/aborted': { readonly [key: string]: unknown }
    /** The LLM service is not available. */
    'vscode-tools/llm-unavailable': { readonly [key: string]: unknown }
    /** No model is configured. */
    'vscode-tools/no-model': { readonly [key: string]: unknown }
    /** The LLM adapter failed. */
    'vscode-tools/llm-failed': { readonly [key: string]: unknown }
    /** The model returned an empty commit message. */
    'vscode-tools/llm-empty': { readonly [key: string]: unknown }
    /** The AI bridge failed. */
    'vscode-tools/bridge-failed': { readonly [key: string]: unknown }
  }
}
