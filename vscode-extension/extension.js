/**
 * DSH AI Commit Message — VS Code extension for the code-server embedded in
 * dsh-web-vscode.
 *
 * Adds a sparkle icon next to the commit button in the Source Control view
 * (menu group navigation@-1, which lands BEFORE the commit checkmark — same
 * position logic as dsh-web-ide's SCM panel). Clicking it:
 *
 *  1. reads the bridge URL from env DSH_AI_BRIDGE_URL (passed by the DSH
 *     host when it spawned code-server) or the dsh-ai-commit.bridgeUrl
 *     setting;
 *  2. resolves the focused git repository's root via the built-in git
 *     extension's exported API;
 *  3. POSTs {workspaceRoot} to the bridge — the DSH host collects the diff
 *     (staged preferred, intent-to-add for untracked, 32 KiB cap), calls the
 *     configured LLM, and sanitizes the output (identical pipeline to
 *     dsh-web-ide's gitGenerateCommitMessage);
 *  4. writes the message into the repository's SCM input box, focused.
 *
 * While a request is in flight the button shows a stop icon and cancels the
 * generation instead. Errors surface as notifications with their bridge code.
 */
'use strict'

const vscode = require('vscode')

/** The in-flight generation's AbortController, when one is running. */
let inFlight = null

function bridgeUrl() {
  const fromEnv = process.env.DSH_AI_BRIDGE_URL
  if (fromEnv && fromEnv.startsWith('http://127.0.0.1:')) return fromEnv
  const fromSetting = vscode.workspace.getConfiguration('dsh-ai-commit').get('bridgeUrl')
  if (typeof fromSetting === 'string' && fromSetting.startsWith('http://127.0.0.1:')) return fromSetting
  return null
}

/** The git extension's exported API (vscode.git). */
async function gitApi() {
  const ext = vscode.extensions.getExtension('vscode.git')
  if (ext === undefined) return null
  const api = await ext.activate()
  return api && typeof api.getRepositories === 'function' ? api : null
}

/** The repository matching the focused SCM view / first folder. Mirrors how
 *  VS Code's own git commands resolve the "current" repository. */
async function currentRepository() {
  const api = await gitApi()
  if (api === null) return null
  const repositories = api.repositories ?? []
  if (repositories.length === 0) return null
  if (repositories.length === 1) return repositories[0]
  // Multi-root: prefer the repository of the active editor's file, else the
  // first workspace folder's repository.
  const active = vscode.window.activeTextEditor?.document.uri.fsPath
  if (active !== undefined) {
    const match = repositories.find((r) => active.startsWith(r.rootUri.fsPath + '/'))
    if (match !== undefined) return match
  }
  const first = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (first !== undefined) {
    const match = repositories.find((r) => first.startsWith(r.rootUri.fsPath))
    if (match !== undefined) return match
  }
  return repositories[0]
}

/** The repository's SCM input box — via the git API when available (per-repo
 *  input), else the deprecated global vscode.scm.inputBox. */
function inputBoxFor(repository) {
  if (repository !== null && repository.inputBox !== undefined) return repository.inputBox
  return vscode.scm.inputBox ?? null
}

async function generate(repository) {
  if (inFlight !== null) {
    // Second click while running = stop (same as dsh-web-ide's busy state).
    inFlight.abort()
    return
  }
  const url = bridgeUrl()
  if (url === null) {
    vscode.window.showWarningMessage('DSH AI Commit: the DSH host bridge is unavailable (restart the VS Code tab from DSH).')
    return
  }
  if (repository === null) {
    vscode.window.showWarningMessage('DSH AI Commit: no git repository is open.')
    return
  }
  const input = inputBoxFor(repository)
  if (input === null) {
    vscode.window.showWarningMessage('DSH AI Commit: the SCM input box is unavailable.')
    return
  }

  const ctrl = new AbortController()
  inFlight = ctrl
  await vscode.commands.executeCommand('setContext', 'dsh-ai-commit.generating', true)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: repository.rootUri.fsPath }),
      signal: ctrl.signal,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const code = body.code ?? ('http-' + String(res.status))
      const detail = body.error ?? res.statusText
      if (code === 'vscode-tools/no-changes') {
        vscode.window.showInformationMessage('DSH AI Commit: no uncommitted changes to generate a message from.')
      } else if (code !== 'aborted') {
        vscode.window.showErrorMessage('DSH AI Commit: ' + String(detail))
      }
      return
    }
    if (typeof body.message === 'string' && body.message.length > 0) {
      input.value = body.message
      // VS Code parity: focus the SCM input with the caret at the end so the
      // message can be reviewed and committed immediately.
      await vscode.commands.executeCommand('workbench.scm.focus')
      if (typeof input.selection === 'object' && input.selection !== null) {
        const end = body.message.length
        input.selection = { start: end, end }
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted !== true) {
      vscode.window.showErrorMessage('DSH AI Commit: ' + (err instanceof Error ? err.message : String(err)))
    }
  } finally {
    inFlight = null
    await vscode.commands.executeCommand('setContext', 'dsh-ai-commit.generating', false)
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh-ai-commit.generate', async () => {
      const repository = await currentRepository()
      await generate(repository)
    }),
  )
}

module.exports = { activate, deactivate() {} }
