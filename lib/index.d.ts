import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";

//#region src/index.d.ts

/** Public shape returned to the client (iframe URL + port + ready flag). */
interface VscodeInfo {
  readonly url: string;
  readonly port: number;
  readonly ready: boolean;
}
declare class VscodeTools extends TypertRemoteService {
  static inject: string[];
  static Config: {};
  /** One code-server per DSH Session. */
  private readonly vscodeServers;
  constructor(ctx: Context, _config: Record<string, never>);
  /**
   * Start (or reuse) a code-server instance for this workspace and return the
   * iframe URL. The page embeds a real VS Code in a tab; closing the tab keeps
   * the server running so reopening is instant; "Stop Server" shuts it down.
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
  /** One HTTP probe: is the workbench serving? */
  private probeVscode;
  private stopVscode;
  /** Plugin teardown: terminate every still-live code-server. The processes
   *  are children of the host, not of the browser tab; a page that reloads or
   *  unmounts would otherwise leave them running forever. */
  private disposeAll;
}
//#endregion
export { VscodeInfo, VscodeTools, VscodeTools as default };