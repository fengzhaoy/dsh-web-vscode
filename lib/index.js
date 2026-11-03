import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { existsSync } from "node:fs";

//#region src/vscode-server.ts
/**
* Where a code-server binary may live, in preference order.
*
* `env.HOME` wins over `homedir()`: when a caller passes an env it means it,
* and os.homedir() ignores the env entirely (it reads the passwd entry), which
* made a sandboxed HOME silently fall back to the real user's install.
*
* `env.PATH` is searched too: a version manager (nvm, fnm, volta, asdf) puts
* npm globals in a node-version-specific bin dir such as
* `~/.nvm/versions/node/v24.14.0/bin`, which no fixed path list can predict.
*/
function codeServerCandidates(env = process.env) {
	const out = [];
	const explicit = env.DSH_IDE_VSCODE_BIN;
	if (explicit !== void 0 && explicit !== "") out.push(explicit);
	const home = env.HOME !== void 0 && env.HOME !== "" ? env.HOME : homedir();
	out.push(join(home, ".npm-global", "bin", "code-server"));
	out.push("/opt/homebrew/bin/code-server");
	out.push("/usr/local/bin/code-server");
	out.push(join(home, ".local", "bin", "code-server"));
	out.push(join(home, "Library", "pnpm", "code-server"));
	const path = env.PATH;
	if (path !== void 0 && path !== "") {
		for (const dir of path.split(delimiter)) if (dir !== "") out.push(join(dir, "code-server"));
	}
	return out;
}
/** First existing code-server binary, or null. */
function findCodeServer(env = process.env) {
	for (const candidate of codeServerCandidates(env)) try {
		if (existsSync(candidate)) return candidate;
	} catch {}
	return null;
}
/**
* Args for a headless, locally trusted server.
*
* `--disable-workspace-trust` is required for extensions to activate at all:
* a fresh workspace opens in Restricted Mode, where extension hosts are
* launched but every extension is disabled. The user accepted that trade-off.
*/
function codeServerArgs(options) {
	return [
		"--bind-addr",
		"127.0.0.1:" + String(options.port),
		"--auth",
		"none",
		"--user-data-dir",
		options.userDataDir,
		"--extensions-dir",
		options.extensionsDir,
		"--disable-workspace-trust",
		"--disable-telemetry",
		"--disable-update-check"
	];
}
/** Build the iframe URL that opens `folder` in the workbench. */
function workspaceUrl(origin, folder) {
	return origin + "/?folder=" + encodeURIComponent(folder);
}
/** Pick a free-ish port deterministically from a base, avoiding a range the
*  caller already holds. */
function nextFreePort(base, inUse) {
	const taken = new Set();
	for (const p of inUse) taken.add(p);
	let port = base;
	while (taken.has(port) && port < base + 100) port += 1;
	return port;
}

//#endregion
//#region src/index.ts
/** Prototype marker the typert protocol's Remote decorators write; declared
*  here as a plain property so this package needs no decorator lowering
*  (rolldown's native transform passes Stage-3 decorator syntax through, which
*  Node cannot parse). The gateway's source-mode discovery and remoteMethods()
*  readers consume exactly this shape. */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
var VscodeTools = class extends TypertRemoteService {
	static inject = ["subprocess", "sessions"];
	static Config = {};
	/** One code-server per DSH Session. */
	vscodeServers = new Map();
	constructor(ctx, _config) {
		super(ctx, "vscodeTools");
		Object.defineProperty(Object.getPrototypeOf(this), REMOTE_METHODS_KEY, {
			configurable: true,
			value: Object.freeze({
				version: 1,
				methods: Object.freeze([
					Object.freeze({
						method: "vscodeOpen",
						invocation: Object.freeze({ kind: "direct" })
					}),
					Object.freeze({
						method: "vscodeStatus",
						invocation: Object.freeze({ kind: "direct" })
					}),
					Object.freeze({
						method: "vscodeStop",
						invocation: Object.freeze({ kind: "direct" })
					})
				])
			})
		});
	}
	/**
	* Start (or reuse) a code-server instance for this workspace and return the
	* iframe URL. The page embeds a real VS Code in a tab; closing the tab keeps
	* the server running so reopening is instant; "Stop Server" shuts it down.
	*/
	async vscodeOpen(workspaceFileScope, spec, _signal) {
		const { sessionId, workspaceRoot } = workspaceFileScope;
		const existing = this.vscodeServers.get(sessionId);
		if (existing !== void 0 && spec.restart !== true) {
			const ready = await this.probeVscode(existing);
			return {
				url: workspaceUrl(existing.origin, workspaceRoot),
				port: existing.port,
				ready
			};
		}
		if (existing !== void 0) await this.stopVscode(sessionId);
		const bin = findCodeServer();
		if (bin === null) throw new RemoteError("vscode-tools/vscode-missing", "code-server is not installed on this machine", {});
		const port = nextFreePort(8787, [...this.vscodeServers.values()].map((e) => e.port));
		const stateDir = join(homedir(), ".dsh-ide", "code-server");
		const origin = "http://127.0.0.1:" + String(port);
		const handle = this.ctx.subprocess.spawn({
			argv: [bin, ...codeServerArgs({
				port,
				userDataDir: join(stateDir, "user-data"),
				extensionsDir: join(stateDir, "extensions")
			})],
			cwd: workspaceRoot,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: 2e5 },
				stderr: { maxBytes: 2e5 }
			},
			graceMs: 5e3
		});
		this.vscodeServers.set(sessionId, {
			port,
			origin,
			handle,
			startedAt: Date.now(),
			ready: false
		});
		handle.done.then(() => {
			this.vscodeServers.delete(sessionId);
		}).catch(() => void 0);
		for (let i = 0; i < 100; i += 1) {
			const server = this.vscodeServers.get(sessionId);
			if (server === void 0) break;
			if (await this.probeVscode(server)) {
				server.ready = true;
				return {
					url: workspaceUrl(origin, workspaceRoot),
					port,
					ready: true
				};
			}
			await new Promise((r) => setTimeout(r, 150));
		}
		await this.stopVscode(sessionId);
		throw new RemoteError("vscode-tools/vscode-timeout", "code-server did not answer on its port", {});
	}
	/** Current state of this Session's VS Code server, if any. */
	async vscodeStatus(workspaceFileScope, _signal) {
		const server = this.vscodeServers.get(workspaceFileScope.sessionId);
		if (server === void 0) return null;
		return {
			url: workspaceUrl(server.origin, workspaceFileScope.workspaceRoot),
			port: server.port,
			ready: await this.probeVscode(server)
		};
	}
	/** Stop this Session's VS Code server. */
	async vscodeStop(workspaceFileScope, _signal) {
		workspaceFileScope.workspaceRoot;
		await this.stopVscode(workspaceFileScope.sessionId);
	}
	/** One HTTP probe: is the workbench serving? */
	async probeVscode(server) {
		try {
			const res = await fetch(server.origin + "/", { signal: AbortSignal.timeout(1e3) });
			return res.ok || res.status === 302;
		} catch {
			return false;
		}
	}
	async stopVscode(sessionId) {
		const server = this.vscodeServers.get(sessionId);
		if (server === void 0) return;
		this.vscodeServers.delete(sessionId);
		try {
			await Promise.resolve(server.handle.terminate?.());
		} catch {}
	}
	/** Plugin teardown: terminate every still-live code-server. The processes
	*  are children of the host, not of the browser tab; a page that reloads or
	*  unmounts would otherwise leave them running forever. */
	async disposeAll() {
		const servers = [...this.vscodeServers.values()];
		this.vscodeServers.clear();
		await Promise.allSettled(servers.map(async (server) => {
			try {
				await Promise.resolve(server.handle.terminate?.());
			} catch {}
		}));
	}
};
var src_default = VscodeTools;

//#endregion
export { VscodeTools, src_default as default };