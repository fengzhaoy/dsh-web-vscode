import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/index.d.ts

/** Public shape returned to the client (iframe URL + port + ready flag). */
interface VscodeInfo {
  readonly url: string;
  readonly port: number;
  readonly ready: boolean;
}
/** Result of the AI commit-message generator. */
interface CommitMessageResult {
  readonly message: string;
}
declare class VscodeTools extends TypertRemoteService {
  static inject: string[];
  static Config: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
  /** One code-server per DSH Session. */
  private readonly vscodeServers;
  private static readonly GIT_STDOUT_MAX_BYTES;
  private static readonly GIT_STDERR_MAX_BYTES;
  private static readonly GIT_TIMEOUT_MS;
  constructor(ctx: Context, _config: Record<string, never>);
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
  vscodeOpen(workspaceFileScope: {
    sessionId: string;
    workspaceRoot: string;
  }, spec: {
    restart?: boolean;
  }, _signal: AbortSignal): Promise<VscodeInfo>;
  /** Current state of this Session's VS Code server, if any. */
  vscodeStatus(workspaceFileScope: {
    sessionId: string;
    workspaceRoot: string;
  }, _signal: AbortSignal): Promise<VscodeInfo | null>;
  /** Stop this Session's VS Code server. */
  vscodeStop(workspaceFileScope: {
    sessionId: string;
    workspaceRoot: string;
  }, _signal: AbortSignal): Promise<void>;
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
  generateCommitMessage(workspaceFileScope: {
    sessionId: string;
    workspaceRoot: string;
  }, signal: AbortSignal | undefined): Promise<CommitMessageResult>;
  private runGit;
  /** Cap a unified diff for the prompt: keep whole per-file sections while
   *  the byte budget lasts (so no file is cut mid-hunk), then note how many
   *  files were omitted. A single oversized section (e.g. a rebuilt bundle)
   *  keeps its head at the budget. */
  private truncateDiffForPrompt;
  /** Clean model output: strip markdown fences and commit-message label
   *  lines and signature lines, collapse runs of blank lines, trim. */
  private sanitizeCommitMessage;
  /** Start the localhost AI bridge for one Session's code-server. Returns
   *  null when no port could be bound (the extension then shows its
   *  unavailable hint; everything else keeps working). */
  private startBridge;
  /** One POST /commit-message {workspaceRoot} → {message}. Loopback only. */
  private handleBridgeRequest;
  /** Copy the bundled dsh-ai-commit extension into the shared extensions dir.
   *  Idempotent: skipped when the installed copy already matches this build's
   *  extension.js (cheap content hash). The dir is shared with dsh-web-ide's
   *  code-server instances, which simply ignore the extra extension. */
  private installBundledExtension;
  /** Ensure extensions.json lists the bundled extension. Best effort: a
   *  malformed manifest is reset to a fresh list with just this entry. */
  private registerExtensionManifestEntry;
  private stopBridge;
  /** One HTTP probe: is the workbench serving? */
  private probeVscode;
  private stopVscode;
  /** Plugin teardown: terminate every still-live code-server. The processes
   *  are children of the host, not of the browser tab; a page that reloads or
   *  unmounts would otherwise leave them running forever. */
  private disposeAll;
}
//#endregion
export { CommitMessageResult, VscodeInfo, VscodeTools, VscodeTools as default };