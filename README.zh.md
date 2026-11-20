# Outlive

把编码 Agent 和 shell 命令交给 **会话之外** 的瞬态 systemd unit 执行。关掉浏览器标签、结束会话、重启 `dsh` 进程都不影响它跑完；结束后结果回到对话里。

同时内置了大多数安装真正需要的那件运维任务：**重启 DSH Web**。无论 `dsh` 是否被 systemd 托管，重启都能正确完成。

```
浏览器面板 ──▶ /__outlive/* ──▶ systemd-run --user --unit=outlive-<job>
                                        │
   日志 + exit 标记 ◀── out.log / exit ─┘
```

## 运行要求

| | |
|---|---|
| 操作系统 | Linux，且有 systemd **用户**实例（`systemd-run --user`、`systemctl --user`） |
| DSH | `>= 0.2.2-rc.3` |
| Node | `>= 20` |

不支持 macOS 与 Windows：宿主侧依赖 systemd 用户 unit。需要跨平台的话，请改用 `bash` 的 `run_in_background`。

## 安装

```bash
dsh plugin --profile web add @whiplashf/dsh-outlive
```

安装后重启一次 DSH Web，宿主侧与前端 bundle 才会加载。之后侧栏会出现 **Outlive** 面板。

包内声明了 `dsh.bundle` 与 `dsh.client`，插件管理器会自动把它写进 profile 的 bundle 列表。Web 应用用 `web` 这个 profile 名，终端应用换成 `tui`。

## 使用

### 重启 DSH Web（内置任务）

打开 **Outlive** → **重启 DSH Web** → **运行**。运行前面板会显示本次计划：

- **unit 模式** —— `dsh` 进程是某个持久用户 unit 的主进程（例如 `dsh-web.service`）。任务执行 `systemctl --user restart <unit>`，交给 systemd 完成重启，新进程仍在监管之下。
- **process 模式** —— 没有持久 unit 拥有这个进程。任务从 `/proc` 读取当前 argv、工作目录与环境变量，发送 `SIGTERM`，再在**新的瞬态 unit** 中用同样的命令拉起，因此重启动作不会被它要重启的进程一起带走。

两种模式都会等待旧进程监听过的端口（通过 `ss -Hltnp`，或 argv 里的 `--port`）恢复响应，只有端口真的通了才算成功。面板所在页面会自行重连，任务继续跑。

内置任务可以像普通常用任务一样删除，也能在同一面板一键恢复；历史运行记录保留。

### 把任务交给 Agent

1. 选择 Agent。已检测到的 CLI 会显示可执行文件路径与版本；`auto` 按 OpenCode → Codex → Claude Code 的顺序取第一个可用的。
2. 写任务。Agent 看不到当前对话，所以背景、路径、验收标准都要写进任务文本。
3. 可选：设置工作目录（文件选择器）与运行时长上限（默认 2 小时）。
4. 展开 **命令预览**，投递前先看完整命令。

任务文本以 `0600` 写入 `task.txt`，Agent 通过命令替换 `"$(cat …)"` 读取，因此任务里的引号和换行不会被 shell 解释。

### 跑 shell 命令

同一个面板的 **命令** 标签页。构建、迁移、看日志这类用一条命令就能表达的事情走这里。

### 常用任务

**保存** 只存不跑，**运行** 直接投递。保存按 `kind + 命令/任务 + agent + cwd` 去重，重复保存会把该条提到最前而不是产生副本。最多保留 40 条。

## 模型工具

会话里的模型可以直接调用下列工具。通过工具投递的任务在结束后把结果送回同一段对话。

| 工具 | 用途 |
|---|---|
| `outlive_agent` | 把整段任务交给编码 Agent。参数：`task`（必填）、`agent`、`label`、`cwd`、`runtime_max_sec` |
| `outlive_run` | 跑一条 shell 命令。参数：`command`（必填）、`label`、`cwd`、`runtime_max_sec`、`env` |
| `outlive_agents` | 列出检测到的 Agent、路径、版本、参数是否已核实。参数：`refresh` |
| `outlive_status` | 查看任务状态、退出码与日志尾部。参数：`id`、`tail_lines` |
| `outlive_list` | 最近的任务，最新的在前。参数：`limit` |
| `outlive_cancel` | 中止运行中的任务。参数：`id` |
| `outlive_engines` | `outlive_agents` 的弃用别名，2.0 移除 |

## Agent 支持

只有参数模板经过真实 CLI 验证的预设才标记为 **已核实**：

| Agent | 参数 | 已核实 |
|---|---|---|
| OpenCode（`opencode`） | `run --standalone --auto --archived --title {title} -- {file}` | 是 |
| Codex（`codex`） | `exec --skip-git-repo-check -s workspace-write -- {file}` | 是 |
| Claude Code（`claude`） | `-p --dangerously-skip-permissions {file}` | 是 |
| Gemini CLI、Cursor Agent、GitHub Copilot CLI、Aider、Qwen Code、Goose、Crush、Amp | — | 否：能检测到，需补参数 |

未核实的预设仍会被探测，面板会如实显示「已安装，需补参数」，而不是假装它可用。

**其他 CLI** 可以直接在面板里添加：用内置文件选择器挑出可执行文件（默认只列可执行文件），填名字，再写一个包含 `{file}` 的参数模板。`{file}` 展开为任务文件，`{title}` 展开为带引号的任务标题。自定义 Agent 与预设同名时覆盖预设。

## 布局与行为

- 面板是居中的单列（最宽 1120 px）加一个固定宽度侧栏；窗口窄于 980 px 时收成单列。
- 面板每 3 秒拉取一次快照；任务日志只在展开且运行中时才读取。
- 任务记录写在 `job.json`，并与 systemd unit 对账，unit 已经没了记录不会一直停在 `running`。
- 面板投递的任务不会回送聊天通知（面板拿不到会话 id）；工具投递的会。

## 状态目录

```
$OUTLIVE_HOME
  或 ${XDG_STATE_HOME:-~/.local/state}/outlive/
    jobs/<12-hex>/{job.json,command.sh,run.sh,out.log,exit,…}
    tasks.json
    agents.json
```

`OUTLIVE_HOME` 与配置项 `stateDir` 都可覆盖默认位置。只保留最近 200 条已结束记录，运行中的永不清理。`agents.json`、`tasks.json` 原子写入，文件损坏时改名为 `*.corrupt-*` 保留，而不是直接删除。

## 配置

`cordis.patch.yml` 插入 bundle 时带默认配置：

```yaml
- insert:
    - id: tool-outlive
      name: '@whiplashf/dsh-outlive'
      config:
        pollMs: 3000
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `pollMs` | `3000` | 宿主对账运行中任务的间隔（500–60000） |
| `stateDir` | XDG 状态目录 | 记录存放位置；`OUTLIVE_HOME` 优先于它 |
| `defaultAgent` | `auto` | 请求未指定 Agent 时使用（旧写法 `defaultEngine` 仍兼容） |

## 安全

- 面板 API 只接受带 `x-outlive: 1` 头的请求；跨站表单或 fetch 无法在不触发预检的情况下加这个头，而服务端从不响应预检。
- 文件浏览是只读的，只接受绝对路径，单次最多 1000 条。
- 任务脚本与任务文件位于状态目录内，权限 `0600`/`0700`。
- Agent 任务只继承一份很窄的环境变量白名单（路径、locale、代理、常见 `*_API_KEY`），宿主进程的其他变量不会泄进 unit。
- 重启任务以当前用户身份运行，只能重启你本来就拥有的 unit。

## 排查

| 现象 | 原因与处理 |
|---|---|
| `systemd-run is not available on this host` | 当前会话里没有 systemd 用户实例。以普通用户会话登录（必要时 `loginctl enable-linger`）——没有它 Outlive 无法工作。 |
| 重启任务报「did not come back」 | 进程停了，但端口在 30 秒内没有恢复响应。看任务日志：那是新进程自己的输出。 |
| Agent 显示「需补参数」 | 该预设没有核实过的参数模板。把同一个可执行文件添加为自定义 Agent，写一个含 `{file}` 的参数模板即可。 |
| 面板里一个 Agent 都没有 | `PATH` 上没有装。Outlive 还会搜索 `~/.local/bin`、`~/.opencode/bin`、`~/.bun/bin`、`~/.cargo/bin`、`~/.npm-global/bin`、`~/go/bin`、`/usr/local/bin`、`/usr/local/nodejs/bin`、`/usr/bin`。 |

## 开发

```bash
npm test     # node --test，不联网，不需要 systemd
npm run check
```

目录：`index.js`（宿主：记录、路由、工具）、`client.js`（浏览器面板）、`lib/store.js`（记录读写）、`lib/agents.js`（探测与命令构建）、`lib/dispatch.js`（systemd unit）、`lib/restart.js`（重启计划）、`lib/fsbrowse.js`（文件浏览）、`lib/notify.js`（结果消息）。

设计文档：[docs/DESIGN.md](docs/DESIGN.md)、[docs/adr/](docs/adr/)、[GLOSSARY.md](GLOSSARY.md)。

English: [README.md](README.md)

## 许可证

MIT
