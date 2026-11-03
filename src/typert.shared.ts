/**
 * Shared zod schemas + manifest fragments for the vscodeTools typert face.
 * Both manifests (host: src/typert.host.ts, client: src/typert.remote-client.ts)
 * import from here so the wire codecs can never drift apart.
 *
 * Hand-written in the @deepseek-ai/dsh-typert-generator format (see
 * dsh-api-workspace-files/lib/typert.host.js): strict zod v4 codecs exposed
 * via create() factories, lookup parameter reusing the read API's
 * workspaceFileScope, cancellation on the trailing signal.
 */
import { z } from 'zod'

export const PKG = '@zhaoyang10/dsh-web-vscode'

const _vscode_tools_vscodeTools_vscodeOpen_parameter_0$schema = z.intersection(z.string(), z.unknown())
const _vscode_tools_vscodeTools_vscodeOpen_parameter_1$schema = z.object({
  'restart': z.boolean().optional(),
}).readonly()
const _vscode_tools_vscodeTools_vscodeOpen_result$schema = z.object({
  'url': z.string().readonly(),
  'port': z.number().readonly(),
  'ready': z.boolean().readonly(),
}).readonly()

export const scopeParameter = (typeSymbol: string) => ({
  name: 'workspaceFileScope',
  wire: 'workspaceFileScopeId',
  source: 'lookup',
  lookup: 'workspaceFileScope',
  codec: {
    mode: 'strict',
    typeSymbol,
    create: () => _vscode_tools_vscodeTools_vscodeOpen_parameter_0$schema,
  },
})

export const vscodeOpenSchema = _vscode_tools_vscodeTools_vscodeOpen_parameter_1$schema
export const vscodeResultSchema = _vscode_tools_vscodeTools_vscodeOpen_result$schema

export const vscodeOpenInvocation = {
  id: PKG + '#vscodeTools/vscodeOpen',
  service: 'vscodeTools',
  namespace: 'vscodeTools',
  method: 'vscodeOpen',
  invocation: { kind: 'direct' },
  parameters: [
    scopeParameter('@deepseek-ai/dsh-session/types#SessionId'),
    {
      name: 'spec',
      wire: 'spec',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: PKG + '#vscodeTools/vscodeOpen:spec',
        create: () => vscodeOpenSchema,
      },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: PKG + '/types#VscodeInfo',
    create: () => vscodeResultSchema,
  },
  sourceLocation: { file: 'src/index.ts', line: 58, column: 3 },
}

export const vscodeStatusInvocation = {
  id: PKG + '#vscodeTools/vscodeStatus',
  service: 'vscodeTools',
  namespace: 'vscodeTools',
  method: 'vscodeStatus',
  invocation: { kind: 'direct' },
  parameters: [
    scopeParameter('@deepseek-ai/dsh-session/types#SessionId'),
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: PKG + '/types#VscodeInfoNullable',
    create: () => z.union([vscodeResultSchema, z.null()]),
  },
  sourceLocation: { file: 'src/index.ts', line: 114, column: 3 },
}

export const vscodeStopInvocation = {
  id: PKG + '#vscodeTools/vscodeStop',
  service: 'vscodeTools',
  namespace: 'vscodeTools',
  method: 'vscodeStop',
  invocation: { kind: 'direct' },
  parameters: [
    scopeParameter('@deepseek-ai/dsh-session/types#SessionId'),
  ],
  cancellation: { parameter: 'signal' },
  result: {
    mode: 'strict',
    typeSymbol: PKG + '/types#void',
    create: () => z.void(),
  },
  sourceLocation: { file: 'src/index.ts', line: 131, column: 3 },
}

/** The service model fragment shared by both manifests. */
export const serviceModel = {
  description: 'Host-backed VS Code Server management: one code-server per DSH Session.',
  summary: 'Host-backed VS Code Server management: one code-server per DSH Session.',
  tags: [] as string[],
  jsDoc: '/** Host-backed VS Code Server management: one code-server per DSH Session. */',
  key: 'vscodeTools',
  exportName: 'VscodeTools',
  members: [
    {
      kind: 'method',
      name: 'vscodeOpen',
      signature: "@Remote async vscodeOpen( workspaceFileScope: WorkspaceFileScope, spec: { restart?: boolean }, signal: AbortSignal, ): Promise<VscodeInfo>",
      summary: 'Start or reuse a code-server for this workspace.',
      jsDoc: '/** Start or reuse a code-server for this workspace. */',
    },
    {
      kind: 'method',
      name: 'vscodeStatus',
      signature: "@Remote async vscodeStatus( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<VscodeInfo | null>",
      summary: "Current code-server state, or null when none is running.",
      jsDoc: '/** Current code-server state, or null when none is running. */',
    },
    {
      kind: 'method',
      name: 'vscodeStop',
      signature: "@Remote async vscodeStop( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<void>",
      summary: 'Stop the code-server for this Session.',
      jsDoc: '/** Stop the code-server for this Session. */',
    },
  ],
}
