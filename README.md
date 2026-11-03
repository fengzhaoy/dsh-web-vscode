# @zhaoyang10/dsh-web-vscode

ss
DSH web 客户端的 VS Code tab 插件：在「会话」tab 后面和右侧栏各注册一个 **VS Code** tab，点击打开即默认进入内嵌 VS Code（code-server）工作区页面——等价于 dsh-web-ide 左侧栏 VS Code 图标打开的那个页面。

## 架构

- **宿主端（lib/index.js）**：`VscodeTools` typert Remote 服务（namespace `vscodeTools`），每个 DSH Session 管理一个 code-server 进程（`vscodeOpen` / `vscodeStatus` / `vscodeStop`），绑定 127.0.0.1，探测就绪后返回 iframe URL。
- **客户端（lib/client.js）**：
  - `conversation.view` slot 注册 id `vscode`、order 1（chat=0 之后、trajectory=10 之前）；
  - `sidebarRightTabs` 注册右侧栏 tab（kind `vscode`，keepMounted），打开时自动全屏（模拟点击 `[data-sidebar-right-mode=fullscreen]`，与手动点击同一路径）；
  - `VscodeView` 首次挂载即自动 `vscodeOpen`，iframe 加载 workbench；关闭 tab 不杀进程，重开即时恢复，「停止服务」才关闭。

## 依赖

宿主机需安装 code-server：`npm i -g code-server`（或设置 `DSH_IDE_VSCODE_BIN` 指定二进制路径）。状态目录：`~/.dsh-ide/code-server/`（与 dsh-web-ide 共享，扩展/用户数据互通）。

## 开发

```bash
pnpm install
pnpm bundle        # tsdown 构建到 lib/
pnpm test          # 静态检查 + code-server 真实启动往返（已安装时）
```

## 安装到 dsh

```bash
dsh plugin --profile web add link:<repo-path>
```

或手动：profile package.json dependencies 写入 `"link:/abs/path"`，`node_modules/@zhaoyang10` 下建相对 symlink，并把包名加入 `dsh.profile.bundles`。

## 许可

MIT
