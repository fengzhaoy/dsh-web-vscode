import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createServer } from "node:http";
import { delimiter, join } from "node:path";
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { deepFreeze } from "@deepseek-ai/dsh-util-values";

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
/** Pick a genuinely bindable port deterministically from a base, avoiding
*  the ports the caller already holds AND ports other processes on this
*  machine hold (e.g. dsh-web-ide's code-server on the shared 8787): probe
*  each candidate by binding a listener and dropping it. Falls back to the
*  first non-taken candidate if every probe errors for an unexpected reason
*  (never blocks the spawn on probe infrastructure failing). */
async function nextFreePort(base, inUse) {
	const taken = new Set();
	for (const p of inUse) taken.add(p);
	let firstFree = -1;
	for (let port = base; port < base + 100; port += 1) {
		if (taken.has(port)) continue;
		if (await isBindable(port)) return port;
		if (firstFree < 0) firstFree = port;
	}
	return firstFree >= 0 ? firstFree : base + 100;
}
/** True when a loopback listener can bind the port right now. */
function isBindable(port) {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
	});
}

//#endregion
//#region src/index.ts
/** Prototype marker the typert protocol's Remote decorators write; declared
*  here as a plain property so this package needs no decorator lowering
*  (rolldown's native transform passes Stage-3 decorator syntax through, which
*  Node cannot parse). The gateway's source-mode discovery and remoteMethods()
*  readers consume exactly this shape. */
const REMOTE_METHODS_KEY = "@deepseek-ai/dsh-typert-protocol/remote-methods";
var VscodeTools = class VscodeTools extends TypertRemoteService {
	static inject = [
		"subprocess",
		"sessions",
		"llm",
		"agentDefaultModel"
	];
	static Config = z.object({});
	/** One code-server per DSH Session. */
	vscodeServers = new Map();
	static GIT_STDOUT_MAX_BYTES = 8 * 1024 * 1024;
	static GIT_STDERR_MAX_BYTES = 16 * 1024;
	static GIT_TIMEOUT_MS = 2e4;
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
					}),
					Object.freeze({
						method: "generateCommitMessage",
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
	*
	* An AI bridge (localhost HTTP) is started alongside and its URL is passed
	* to the child via env DSH_AI_BRIDGE_URL — the bundled VS Code extension
	* POSTs {workspaceRoot} to it to generate commit messages with the host's
	* configured LLM.
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
		const port = await nextFreePort(8787, [...this.vscodeServers.values()].map((e) => e.port));
		const stateDir = join(homedir(), ".dsh-ide", "code-server");
		const origin = "http://127.0.0.1:" + String(port);
		const bridge = await this.startBridge(sessionId);
		const env = {};
		if (bridge !== null) env.DSH_AI_BRIDGE_URL = "http://127.0.0.1:" + String(bridge.port) + "/commit-message";
		const extensionsDir = join(stateDir, "extensions");
		await this.installBundledExtension(extensionsDir);
		const handle = this.ctx.subprocess.spawn({
			argv: [bin, ...codeServerArgs({
				port,
				userDataDir: join(stateDir, "user-data"),
				extensionsDir
			})],
			cwd: workspaceRoot,
			env,
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
			ready: false,
			bridge: bridge ?? void 0
		});
		handle.done.then(() => {
			this.stopBridge(sessionId);
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
	/**
	* AI-generate a commit message from the workspace's uncommitted changes,
	* using the currently configured LLM (agentDefaultModel). Ported verbatim
	* from dsh-web-ide's IdeTools.gitGenerateCommitMessage.
	*
	* Mirrors the VS Code SCM AI assistants (Copilot / WeCode): the staged diff
	* is preferred when the index holds changes, otherwise the whole working
	* tree is used. The prompt also carries the branch name and the recent
	* commit subjects so the message matches the repository's language and
	* message conventions. The diff is capped per file section at 32 KiB and
	* the model output is sanitized (fences/labels stripped) before it lands in
	* the commit input.
	*/
	async generateCommitMessage(workspaceFileScope, signal) {
		const { workspaceRoot: cwd } = workspaceFileScope;
		if (!cwd) throw new RemoteError("vscode-tools/no-workspace", "workspace root is not set", {});
		let diff = "";
		let diffSource = "working-tree";
		const untracked = [];
		try {
			const statusRaw = await this.runGit(cwd, [
				"status",
				"--porcelain=v1",
				"--untracked-files=all",
				"-z"
			], signal);
			for (const part of statusRaw.split("\0")) if (part.startsWith("?? ")) untracked.push(part.slice(3));
			if (untracked.length > 0) try {
				await this.runGit(cwd, [
					"add",
					"-N",
					"--",
					...untracked
				], signal);
			} catch {}
			diff = await this.runGit(cwd, [
				"diff",
				"--cached",
				"--no-color"
			], signal);
			if (diff.trim().length > 0) diffSource = "staged";
			else {
				diff = await this.runGit(cwd, [
					"diff",
					"HEAD",
					"--no-color"
				], signal).catch(() => "");
				if (diff.trim().length === 0) diff = await this.runGit(cwd, ["diff", "--no-color"], signal);
			}
		} catch (err) {
			if (err instanceof RemoteError && err.code === "vscode-tools/not-a-repo") throw new RemoteError("vscode-tools/not-a-repo", "workspace is not a git repository", {});
			throw err;
		} finally {
			if (untracked.length > 0) try {
				await this.runGit(cwd, [
					"reset",
					"-q",
					"--",
					...untracked
				], signal);
			} catch {}
		}
		if (diff.trim().length === 0) throw new RemoteError("vscode-tools/no-changes", "no uncommitted changes to generate a message from", {});
		const branch = await this.runGit(cwd, ["branch", "--show-current"], signal).catch(() => "");
		const recentSubjects = await this.runGit(cwd, [
			"log",
			"--format=%s",
			"-n",
			"10"
		], signal).catch(() => "");
		const MAX_DIFF = 32 * 1024;
		const trimmed = this.truncateDiffForPrompt(diff, MAX_DIFF);
		const ctx = this.ctx;
		if (!ctx.llm) throw new RemoteError("vscode-tools/llm-unavailable", "LLM service is not available", {});
		const selection = ctx.agentDefaultModel?.currentSelection();
		if (!selection || !selection.provider || !selection.model) throw new RemoteError("vscode-tools/no-model", "no model is configured", {});
		const systemPrompt = [
			"You are an expert software engineer who writes git commit messages.",
			"You will receive the current branch name, the recent commit subjects, and a git diff.",
			"Generate ONE commit message following the Conventional Commits specification:",
			"  <type>(<optional scope>): <subject>",
			"  <optional body>",
			"",
			"Rules:",
			"- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
			"- subject: imperative mood, no trailing period, max 50 chars",
			"- body (optional): wrap at 72 chars, explain what and why (not how); separate it from the subject with one blank line",
			"- When recent commit subjects are provided, match their language and phrasing style (e.g. write Chinese if the history is Chinese); otherwise use the language of the diff, else English.",
			"- Focus on the meaningful source changes; ignore generated/build artifacts when real changes exist.",
			"- Output ONLY the commit message: no markdown fences, no quotes, no explanations."
		].join("\n");
		const styleBlock = recentSubjects.trim().length > 0 ? "Recent commit subjects (style reference):\n" + recentSubjects.trim() : "No recent commit history available.";
		const userText = [
			"Branch: " + (branch.trim().length > 0 ? branch.trim() : "(unknown)"),
			"",
			styleBlock,
			"",
			diffSource === "staged" ? "Staged changes (git diff --cached):" : "Working tree changes (git diff HEAD):",
			"",
			"```",
			trimmed,
			"```"
		].join("\n");
		const messages = [createUserMessage({
			content: [{
				type: "text",
				text: userText
			}],
			source: { kind: "user" }
		})];
		const options = deepFreeze({
			provider: selection.provider,
			model: selection.model,
			reasoningEffort: selection.reasoningEffort,
			system: systemPrompt,
			messages,
			signal
		});
		const assembler = new BlockAssembler();
		let finish;
		for await (const chunk of ctx.llm.stream(options)) {
			if (signal?.aborted) break;
			if (chunk.type === "finish") {
				finish = chunk.reason;
				continue;
			}
			assembler.push(chunk);
		}
		if (signal?.aborted || finish?.kind === "aborted") throw new RemoteError("vscode-tools/aborted", "commit message generation was cancelled", {});
		if (finish?.kind === "error") {
			const cause = finish.failure?.message ?? finish.failure?.code ?? "unknown adapter failure";
			throw new RemoteError("vscode-tools/llm-failed", cause, {});
		}
		const blocks = assembler.blocks();
		const message = this.sanitizeCommitMessage(blocks.map((b) => b.text ?? "").join(""));
		if (message.length === 0) throw new RemoteError("vscode-tools/llm-empty", "the model returned an empty commit message", {});
		return { message };
	}
	async runGit(workspaceRoot, argv, signal) {
		const spec = {
			argv: ["git", ...argv],
			cwd: workspaceRoot,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: VscodeTools.GIT_STDOUT_MAX_BYTES },
				stderr: { maxBytes: VscodeTools.GIT_STDERR_MAX_BYTES }
			},
			graceMs: 5e3,
			signal
		};
		let handle;
		try {
			handle = this.ctx.subprocess.spawn(spec);
		} catch {
			throw new RemoteError("vscode-tools/git-failed", "git command could not start", {});
		}
		let outcome;
		let timer;
		const timeout = new Promise((_resolve, reject) => {
			timer = setTimeout(() => {
				Promise.resolve(handle.terminate?.()).catch(() => void 0);
				reject(new RemoteError("vscode-tools/git-timeout", `git ${argv[0] ?? ""} did not finish within ${VscodeTools.GIT_TIMEOUT_MS} ms`, {}));
			}, VscodeTools.GIT_TIMEOUT_MS);
		});
		try {
			outcome = await Promise.race([handle.done, timeout]);
		} catch (err) {
			if (err instanceof RemoteError) throw err;
			if (signal?.aborted === true) throw new RemoteError("vscode-tools/aborted", "git command was cancelled", {});
			throw new RemoteError("vscode-tools/git-failed", "git process failed before reporting an outcome", {});
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
		const stdout = handle.collected.stdout?.readFrom(0);
		const stderr = handle.collected.stderr?.readFrom(0);
		if (stdout === void 0) throw new RemoteError("vscode-tools/git-failed", "git produced no collected stdout", {});
		const stderrText = stderr?.text ?? "";
		if (outcome.exitCode === 128 && /not a git repository/i.test(stderrText)) throw new RemoteError("vscode-tools/not-a-repo", "the workspace root is not a git repository", {});
		if (outcome.signal !== null || outcome.exitCode === null) throw new RemoteError("vscode-tools/git-failed", "git was killed by signal " + (outcome.signal ?? "(unknown)"), {});
		if (outcome.exitCode !== 0) {
			const detail = stderrText.trim().length > 0 ? stderrText.trim() : stdout.text.trim().slice(-2e3);
			throw new RemoteError("vscode-tools/git-failed", "git exited with code " + outcome.exitCode + ": " + detail, {});
		}
		return stdout.text;
	}
	/** Cap a unified diff for the prompt: keep whole per-file sections while
	*  the byte budget lasts (so no file is cut mid-hunk), then note how many
	*  files were omitted. A single oversized section (e.g. a rebuilt bundle)
	*  keeps its head at the budget. */
	truncateDiffForPrompt(diff, maxBytes) {
		if (diff.length <= maxBytes) return diff;
		const sections = [];
		let current = [];
		for (const line of diff.split("\n")) if (line.startsWith("diff --git ") && current.length > 0) {
			sections.push(current.join("\n"));
			current = [line];
		} else current.push(line);
		if (current.length > 0) sections.push(current.join("\n"));
		let kept = "";
		let omitted = 0;
		for (const section of sections) {
			if (kept.length === 0 && section.length > maxBytes) {
				kept = section.slice(0, maxBytes) + "\n… (file diff truncated)";
				omitted = sections.length - 1;
				break;
			}
			if (kept.length + section.length > maxBytes) {
				omitted += 1;
				continue;
			}
			kept = kept.length === 0 ? section : kept + "\n" + section;
		}
		return kept + (omitted > 0 ? "\n… (" + omitted + " more file diff(s) omitted)" : "");
	}
	/** Clean model output: strip markdown fences and commit-message label
	*  lines and signature lines, collapse runs of blank lines, trim. */
	sanitizeCommitMessage(raw) {
		let text = raw.trim();
		const label = /^\s*(?:suggested commit message|commit message|提交信息|提交消息)\s*[:：]\s*/i;
		text = text.replace(label, "");
		if (text.startsWith("```")) {
			const firstNl = text.indexOf("\n");
			const lastFence = text.lastIndexOf("```");
			if (firstNl > 0 && lastFence > firstNl) text = text.slice(firstNl + 1, lastFence);
		}
		text = text.replace(label, "");
		text = text.split("\n").filter((line) => !/generated\s+(with|by)\b/i.test(line)).join("\n");
		text = text.replace(/\n{3,}/g, "\n\n").trim();
		return text;
	}
	/** Start the localhost AI bridge for one Session's code-server. Returns
	*  null when no port could be bound (the extension then shows its
	*  unavailable hint; everything else keeps working). */
	startBridge(sessionId) {
		return new Promise((resolve) => {
			const server = createServer((req, res) => {
				this.handleBridgeRequest(sessionId, req, res).catch((err) => {
					res.writeHead(500, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
				});
			});
			server.once("error", () => resolve(null));
			server.listen(0, "127.0.0.1", () => {
				const addr = server.address();
				if (addr === null || typeof addr === "string") {
					server.close();
					resolve(null);
					return;
				}
				resolve({
					server,
					port: addr.port
				});
			});
		});
	}
	/** One POST /commit-message {workspaceRoot} → {message}. Loopback only. */
	async handleBridgeRequest(sessionId, req, res) {
		const send = (status, body) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.method !== "POST" || (req.url ?? "").startsWith("/commit-message") !== true) {
			send(404, { error: "not found" });
			return;
		}
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 1024 * 1024) {
				send(413, { error: "body too large" });
				return;
			}
			chunks.push(chunk);
		}
		let parsed;
		try {
			parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			send(400, { error: "invalid JSON body" });
			return;
		}
		if (typeof parsed.workspaceRoot !== "string" || parsed.workspaceRoot.length === 0) {
			send(400, { error: "workspaceRoot is required" });
			return;
		}
		const server = this.vscodeServers.get(sessionId);
		if (server === void 0) {
			send(503, { error: "bridge is shutting down" });
			return;
		}
		try {
			const result = await this.generateCommitMessage({
				sessionId,
				workspaceRoot: parsed.workspaceRoot
			}, void 0);
			send(200, result);
		} catch (err) {
			const code = err instanceof RemoteError ? err.code : "vscode-tools/bridge-failed";
			const message = err instanceof Error ? err.message : String(err);
			send(500, {
				error: message,
				code
			});
		}
	}
	/** Copy the bundled dsh-ai-commit extension into the shared extensions dir.
	*  Idempotent: skipped when the installed copy already matches this build's
	*  extension.js (cheap content hash). The dir is shared with dsh-web-ide's
	*  code-server instances, which simply ignore the extra extension. */
	async installBundledExtension(extensionsDir) {
		try {
			const srcDir = join(__dirname, "vscode-extension");
			if (!existsSync(join(srcDir, "extension.js"))) return;
			const dstDir = join(extensionsDir, "dsh-ai-commit");
			await mkdir(dstDir, { recursive: true });
			const srcJs = await readFile(join(srcDir, "extension.js"), "utf8");
			const dstJsPath = join(dstDir, "extension.js");
			const dstJs = existsSync(dstJsPath) ? await readFile(dstJsPath, "utf8") : "";
			if (dstJs !== srcJs) await writeFile(dstJsPath, srcJs);
			const srcPkg = await readFile(join(srcDir, "package.json"), "utf8");
			const dstPkgPath = join(dstDir, "package.json");
			const dstPkg = existsSync(dstPkgPath) ? await readFile(dstPkgPath, "utf8") : "";
			if (dstPkg !== srcPkg) await writeFile(dstPkgPath, srcPkg);
		} catch (err) {
			console.warn("[ui-vscode] bundled extension install failed:", err instanceof Error ? err.message : String(err));
		}
	}
	stopBridge(sessionId) {
		const server = this.vscodeServers.get(sessionId);
		if (server?.bridge !== void 0) {
			server.bridge.server.close();
			server.bridge = void 0;
		}
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
		this.stopBridge(sessionId);
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
			server.bridge?.server.close();
			try {
				await Promise.resolve(server.handle.terminate?.());
			} catch {}
		}));
	}
};
var src_default = VscodeTools;

//#endregion
export { VscodeTools, src_default as default };