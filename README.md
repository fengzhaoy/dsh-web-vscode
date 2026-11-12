# @zhaoyang10/dsh-web-vscode

DSH web 客户端的 VS Code tab 插件：在「会话」tab 后面和右侧栏各注册一个 **VS Code** tab，点击打开即默认进入内嵌 VS Code（code-server）工作区页面——等价于 dsh-web-ide 左侧栏 VS Code 图标打开的那个页面。

## 架构

- **宿主端（lib/index.js）**：`VscodeTools` typert Remote 服务（namespace `vscodeTools`），每个 DSH Session 管理一个 code-server 进程（`vscodeOpen` / `vscodeStatus` / `vscodeStop`），绑定 127.0.0.1，探测就绪后返回 iframe URL。
- **客户端（lib/client.js）**：
  - `conversation.view` slot 注册 id `vscode`、order 1（chat=0 之后、trajectory=10 之前）；
  - `sidebarRightTabs` 注册右侧栏 tab（kind `vscode`，keepMounted），打开时自动全屏（模拟点击 `[data-sidebar-right-mode=fullscreen]`，与手动点击同一路径）；
  - `VscodeView` 首次挂载即自动 `vscodeOpen`，由 `vscodeFrameHost` 在 `<body>` 上创建**常驻 overlay iframe** 加载 workbench；关闭 tab 不杀进程，重开即时恢复，「停止服务」才关闭。
- **未安装 code-server 的引导（参照 dsh-web-ide）**：点击 VS Code 时若本机找不到 code-server，面板显示安装引导：说明原因、列出 host 实际探测过的路径（`details.searchedPaths`）、按平台给出 `brew install code-server` / `npm install -g code-server`（一键复制）、`DSH_IDE_VSCODE_BIN` 指定路径提示，以及「重试」按钮。若已安装却报缺失，多半是 `dsh web` 的 PATH 里没有它（如 nvm），重启 dsh web 或设置 `DSH_IDE_VSCODE_BIN` 即可。
- **页面缓存（vscodeFrameHost，参照 dsh-web-ide）**：iframe 不放在 React 树里。DSH 切换视图会**卸载**非活动视图的 body，而 iframe 一旦离开文档就会被浏览器销毁、整个 workbench 重新加载。所以 frame 只创建一次，挂在 `<body>` 下的 `position:fixed` 覆盖层中，每帧跟随 `VscodeView` 渲染的锚点（`[data-testid=vscode-anchor]`）；切到「对话」或其它 tab 时只是 `display:none` 隐藏（保留已打开的编辑器、终端与滚动位置），切回来直接复用同一个文档。只有「重载」「停止服务」或 code-server 换了 URL 才会真正销毁重建。右侧栏 non-active tab 由宿主加 `hidden/inert` 隐藏，同样只会 park、不会重载。

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
