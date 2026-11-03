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

/** The git extension's exported API (vscode.git). The activation result is
 *  a GitExtension facade: getAPI(1) returns the versioned API whose
 *  `repositories` getter yields open repositories (this is exactly what the
 *  extension's own "git.api.getRepositories" command uses internally). */
async function gitApi() {
  const ext = vscode.extensions.getExtension('vscode.git')
  if (ext === undefined) return null
  const exported = await ext.activate()
  try {
    if (exported && typeof exported.getAPI === 'function') return exported.getAPI(1)
  } catch { /* model not ready yet */ }
  return null
}

/** The repository matching the focused SCM view / first folder. Mirrors how
 *  VS Code's own git commands resolve the "current" repository. */
async function currentRepository() {
  // The git model scans folders asynchronously after activation — on a cold
  // workbench the repository list can still be empty for a moment. Retry
  // briefly before concluding there is nothing open.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const api = await gitApi()
    const repositories = api === null ? [] : (api.repositories ?? [])
    const found = pickRepository(repositories)
    if (found !== null) return found
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

/** Pick the repository for this command (single, active editor's, or first). */
function pickRepository(repositories) {
  if (repositories.length === 0) return null
  if (repositories.length === 1) return repositories[0]
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

async function currentRepositoryLegacy() {
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

/** Focus the Source Control view once the workbench is up. The embedded
 *  workbench remounts from scratch every time the VS Code tab is re-entered
 *  (the conversation view ring mounts only the active view), and the
 *  workbench's own sidebar restore resets to Explorer on every window load.
 *  Landing on Source Control matches how this tab is used (commit flow). */
async function focusScmView() {
  const enabled = vscode.workspace.getConfiguration('dsh-ai-commit').get('openScmOnStart')
  if (enabled === false) return
  try {
    await vscode.commands.executeCommand('workbench.view.scm')
  } catch { /* workbench not ready — best effort */ }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh-ai-commit.generate', async () => {
      const repository = await currentRepository()
      await generate(repository)
    }),
  )
  // onStartupFinished: run once the workbench UI exists, before the user
  // starts interacting.
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh-ai-commit.focusScm', focusScmView),
  )
  void focusScmView()
}

module.exports = { activate, deactivate() {} }
