/**
 * Shell styles for the VS Code tab (ported from dsh-web-ide's .ide-vscode
 * rules, prefixed vscode-). Injected at runtime by the client bundle (DSH
 * serves only /plugins/<id>/client.js, so the CSS rides inside the JS).
 */
export const VSCODE_STYLES = `
/* While the VS Code view is mounted in the conversation ring, take the full
   column: the session container stretches and the composer seat + width
   handles hide — same approach as dsh-web-ide's IDE view and the git-graph
   view. The composer must not stay visible under the workbench iframe. */
[data-slot='conversation.session']:has([data-vscode-view]) > div{flex:1 1 0% !important;min-height:0 !important}
[data-conversation-scroll]:has([data-vscode-view]) ~ [data-width-handle]{display:none !important}
[data-slot='conversation.session']:has([data-vscode-view]) ~ [data-composer-seat]{display:none}
.vscode-shell{position:absolute;inset:0;display:flex;flex-direction:column;background:#1e1e1e;z-index:3}
.vscode-bar{display:flex;align-items:center;gap:8px;padding:4px 10px;border-bottom:1px solid #2b2b2b;flex:none}
.vscode-title{font-size:12px;font-weight:600;color:#cccccc}
.vscode-origin{font-size:11px;color:#8b8b8b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.vscode-actions{display:flex;gap:4px;flex:none}
.vscode-action{background:none;border:1px solid #3c3c3c;border-radius:3px;color:#cccccc;font-size:11px;padding:2px 8px;cursor:pointer}
.vscode-action:hover{background:#2d2d2d}
.vscode-frame{flex:1;width:100%;border:none;background:#1e1e1e}
.vscode-loading,.vscode-error{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;flex:1;font-size:12px;color:#8b8b8b}
.vscode-error{color:#cccccc}
`
