import { z } from "zod";

//#region src/typert.shared.ts
const PKG = "@zhaoyang10/dsh-web-vscode";
const _vscode_tools_vscodeTools_vscodeOpen_parameter_0$schema = z.intersection(z.string(), z.unknown());
const _vscode_tools_vscodeTools_vscodeOpen_parameter_1$schema = z.object({ "restart": z.boolean().optional() }).readonly();
const _vscode_tools_vscodeTools_vscodeOpen_result$schema = z.object({
	"url": z.string().readonly(),
	"port": z.number().readonly(),
	"ready": z.boolean().readonly()
}).readonly();
const _vscode_tools_vscodeTools_generateCommitMessage_result$schema = z.object({ "message": z.string().readonly() }).readonly();
const scopeParameter = (typeSymbol) => ({
	name: "workspaceFileScope",
	wire: "workspaceFileScopeId",
	source: "lookup",
	lookup: "workspaceFileScope",
	codec: {
		mode: "strict",
		typeSymbol,
		create: () => _vscode_tools_vscodeTools_vscodeOpen_parameter_0$schema
	}
});
const vscodeOpenSchema = _vscode_tools_vscodeTools_vscodeOpen_parameter_1$schema;
const vscodeResultSchema = _vscode_tools_vscodeTools_vscodeOpen_result$schema;
const vscodeOpenInvocation = {
	id: PKG + "#vscodeTools/vscodeOpen",
	service: "vscodeTools",
	namespace: "vscodeTools",
	method: "vscodeOpen",
	invocation: { kind: "direct" },
	parameters: [scopeParameter("@deepseek-ai/dsh-session/types#SessionId"), {
		name: "spec",
		wire: "spec",
		source: "json",
		codec: {
			mode: "strict",
			typeSymbol: PKG + "#vscodeTools/vscodeOpen:spec",
			create: () => vscodeOpenSchema
		}
	}],
	cancellation: { parameter: "signal" },
	result: {
		mode: "strict",
		typeSymbol: PKG + "/types#VscodeInfo",
		create: () => vscodeResultSchema
	},
	sourceLocation: {
		file: "src/index.ts",
		line: 58,
		column: 3
	}
};
const vscodeStatusInvocation = {
	id: PKG + "#vscodeTools/vscodeStatus",
	service: "vscodeTools",
	namespace: "vscodeTools",
	method: "vscodeStatus",
	invocation: { kind: "direct" },
	parameters: [scopeParameter("@deepseek-ai/dsh-session/types#SessionId")],
	cancellation: { parameter: "signal" },
	result: {
		mode: "strict",
		typeSymbol: PKG + "/types#VscodeInfoNullable",
		create: () => z.union([vscodeResultSchema, z.null()])
	},
	sourceLocation: {
		file: "src/index.ts",
		line: 114,
		column: 3
	}
};
const generateCommitMessageInvocation = {
	id: PKG + "#vscodeTools/generateCommitMessage",
	service: "vscodeTools",
	namespace: "vscodeTools",
	method: "generateCommitMessage",
	invocation: { kind: "direct" },
	parameters: [scopeParameter("@deepseek-ai/dsh-session/types#SessionId")],
	cancellation: { parameter: "signal" },
	result: {
		mode: "strict",
		typeSymbol: PKG + "/types#CommitMessageResult",
		create: () => _vscode_tools_vscodeTools_generateCommitMessage_result$schema
	},
	sourceLocation: {
		file: "src/index.ts",
		line: 131,
		column: 3
	}
};
const vscodeStopInvocation = {
	id: PKG + "#vscodeTools/vscodeStop",
	service: "vscodeTools",
	namespace: "vscodeTools",
	method: "vscodeStop",
	invocation: { kind: "direct" },
	parameters: [scopeParameter("@deepseek-ai/dsh-session/types#SessionId")],
	cancellation: { parameter: "signal" },
	result: {
		mode: "strict",
		typeSymbol: PKG + "/types#void",
		create: () => z.void()
	},
	sourceLocation: {
		file: "src/index.ts",
		line: 131,
		column: 3
	}
};
/** The service model fragment shared by both manifests. */
const serviceModel = {
	description: "Host-backed VS Code Server management: one code-server per DSH Session.",
	summary: "Host-backed VS Code Server management: one code-server per DSH Session.",
	tags: [],
	jsDoc: "/** Host-backed VS Code Server management: one code-server per DSH Session. */",
	key: "vscodeTools",
	exportName: "VscodeTools",
	types: [],
	members: [
		{
			kind: "method",
			name: "vscodeOpen",
			signature: "@Remote async vscodeOpen( workspaceFileScope: WorkspaceFileScope, spec: { restart?: boolean }, signal: AbortSignal, ): Promise<VscodeInfo>",
			summary: "Start or reuse a code-server for this workspace.",
			jsDoc: "/** Start or reuse a code-server for this workspace. */"
		},
		{
			kind: "method",
			name: "vscodeStatus",
			signature: "@Remote async vscodeStatus( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<VscodeInfo | null>",
			summary: "Current code-server state, or null when none is running.",
			jsDoc: "/** Current code-server state, or null when none is running. */"
		},
		{
			kind: "method",
			name: "vscodeStop",
			signature: "@Remote async vscodeStop( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<void>",
			summary: "Stop the code-server for this Session.",
			jsDoc: "/** Stop the code-server for this Session. */"
		},
		{
			kind: "method",
			name: "generateCommitMessage",
			signature: "@Remote async generateCommitMessage( workspaceFileScope: WorkspaceFileScope, signal: AbortSignal, ): Promise<CommitMessageResult>",
			summary: "AI-generate a commit message from the uncommitted changes.",
			jsDoc: "/** AI-generate a commit message from the uncommitted changes. */"
		}
	]
};

//#endregion
//#region src/typert.host.ts
const TYPERT = {
	package: PKG,
	face: "host",
	schemas: [],
	invocations: [
		vscodeOpenInvocation,
		vscodeStatusInvocation,
		vscodeStopInvocation,
		generateCommitMessageInvocation
	],
	model: {
		services: [serviceModel],
		events: [],
		objects: []
	}
};
var typert_host_default = TYPERT;

//#endregion
export { TYPERT, typert_host_default as default };