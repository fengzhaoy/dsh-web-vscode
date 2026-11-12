/**
 * Shell styles for the VS Code tab (ported from dsh-web-ide's .ide-vscode
 * rules, prefixed vscode-). Injected at runtime by the client bundle (DSH
 * serves only /plugins/<id>/client.js, so the CSS rides inside the JS).
 *
 * The iframe itself is NOT inside the React tree: vscodeFrameHost keeps it in a
 * <body>-level, position:fixed overlay (.vscode-overlay) that is positioned
 * over the per-mount anchor (.vscode-anchor). A tab switch only hides the
 * overlay, so the loaded workbench is cached instead of reloaded.
 */
export const VSCODE_STYLES = `
/* While the VS Code view is mounted in the conversation ring, take the full
   column: the session container stretches and the composer seat + width
   handles hide — same approach as dsh-web-ide's IDE view and the git-graph
   view. The composer must not stay visible under the workbench iframe. */
[data-slot='conversation.session']:has([data-vscode-view]) > div{flex:1 1 0% !important;min-height:0 !important}
[data-conversation-scroll]:has([data-vscode-view]) ~ [data-width-handle]{display:none !important}
[data-slot='conversation.session']:has([data-vscode-view]) ~ [data-composer-seat]{display:none}
.vscode-shell{position:absolute;inset:0;display:flex;flex-direction:column;background:#1e1e1e;color:#cccccc;z-index:3}
.vscode-bar{display:flex;align-items:center;gap:8px;padding:4px 10px;border-bottom:1px solid #2b2b2b;flex:none}
.vscode-title{font-size:12px;font-weight:600;color:#cccccc}
.vscode-origin{font-size:11px;color:#8b8b8b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.vscode-actions{display:flex;gap:4px;flex:none}
.vscode-action{background:none;border:1px solid #3c3c3c;border-radius:3px;color:#cccccc;font-size:11px;padding:2px 8px;cursor:pointer}
.vscode-action:hover{background:#2d2d2d}
.vscode-loading,.vscode-error{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;flex:1;font-size:12px;color:#8b8b8b;padding:20px;text-align:center}
.vscode-error{color:#cccccc}
/* Missing code-server install guide (ported from dsh-web-ide). */
.vscode-guide{flex:1;min-height:0;overflow:auto;padding:24px 32px;font-size:13px;line-height:1.6;color:#cccccc;max-width:760px}
.vscode-guide-title{font-size:15px;font-weight:600;margin-bottom:8px}
.vscode-guide-reason{margin:0 0 14px;color:#9d9d9d}
.vscode-guide-subtitle{font-weight:600;margin:16px 0 8px}
.vscode-guide-paths{margin:0 0 14px;color:#9d9d9d}
.vscode-guide-paths summary{cursor:pointer}
.vscode-guide-paths ul{margin:6px 0 0;padding-left:20px}
.vscode-guide-paths li{margin:2px 0}
.vscode-install-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}
.vscode-install-cmd{background:#1e1e1e;border:1px solid #2b2b2b;border-radius:4px;padding:4px 10px;
  font-family:Menlo,Consolas,"Courier New",monospace;user-select:all;color:#cccccc}
.vscode-install-note{color:#9d9d9d;font-size:12px}
.vscode-guide-hint{margin:10px 0 0;color:#9d9d9d}
.vscode-guide-hint code,.vscode-guide-reason code{background:#1e1e1e;padding:1px 5px;border-radius:3px}
.vscode-guide-retry{margin-top:18px;padding:6px 18px;cursor:pointer;border:1px solid #0e639c;
  background:#0e639c;color:#fff;border-radius:3px}
.vscode-guide-retry:hover{filter:brightness(1.1)}
/* The anchor only reserves the box the overlay is laid over; the workbench is
   painted by .vscode-overlay, which lives on <body> and never leaves the
   document (that is what keeps the iframe from reloading on a tab switch). */
.vscode-anchor{flex:1;min-height:0;width:100%;background:#1e1e1e}
.vscode-overlay{position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;z-index:2147483000;background:#1e1e1e}
.vscode-overlay[data-hidden='true']{display:none}
.vscode-overlay .vscode-frame{display:block;width:100%;height:100%;border:none;background:#1e1e1e}
`