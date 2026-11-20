# dsh-outlive

给 DSH 一个"交出去就不管了"的执行面：任务跑在 harness 进程之外，重启不中断，结束时把结果送回会话。

## 为什么需要它

内置的后台任务（含 `bash` 的 `run_in_background`）都是 `dsh web` 的子进程。而最需要后台任务的时候，往往正是你要重启 dsh 的时候——重启服务、迁移、修 harness 自己。那一刻：

```
dsh web 重启 ──► 子进程全部消失 ──► 没有日志、没有退出码、不知道跑到哪一步
```

这个插件自己不执行任何东西。它写一个脚本，交给一个独立的 systemd 瞬态 unit（另一个 cgroup），之后只读磁盘：日志、退出标记、元数据。重启 dsh 只丢一个轮询循环，活还在跑，账还在记。

## 六个工具

| 工具 | 作用 |
|---|---|
| `outlive_run` | 把一条 shell 命令投递出去，立刻返回 id |
| `outlive_agent` | 把一整件任务交给离场编码 agent（引擎自动探测） |
| `outlive_engines` | 看本机有哪些编码 agent 可派活 |
| `outlive_status` | 看状态、退出码、日志尾部（重启后照样能查） |
| `outlive_list` | 列出历史任务（跨重启） |
| `outlive_cancel` | 中止还在跑的任务 |

### 执行器自动探测

`outlive_agent` 的 `engine` 留空就是 `auto`：按 `opencode → codex → claude` 的顺序，选本机 PATH 里**第一个装着的**。点名也行，没装会明确报错，不会静默换人。探测结果缓存 30 秒，`outlive_engines` 会强制刷新。

| 引擎 | 命令行 | 权限姿势 |
|---|---|---|
| `opencode` | `opencode run --standalone --auto --archived --title …` | 自动批准 |
| `codex` | `codex exec --skip-git-repo-check -s workspace-write` | 工作区可写，不问 |
| `claude` | `claude -p --dangerously-skip-permissions` | 跳过全部确认 |

三者都是非交互启动、预先授权——因为对面没有人能回答提示。想收回权限，改 `BUILTIN_ENGINES` 里的 `build`，或在 config 里覆盖同名执行器（config 优先）。

## 会话面板

侧栏「离场任务」→ 一块面板，四段：

- **可用 agent**：探到的 CLI（名字、**可执行文件路径**、版本），点「重新检测」重扫 PATH；下面能一键添加预设（opencode / codex / claude / gemini / cursor-agent / copilot），没装的不让加；也能手填可执行文件 + 参数模板（`{file}` 任务文件、`{title}` 标题）
- **新建任务**：写要它做什么（人话），选交给谁，点「交给它」或「只保存」
- **常用任务**：存过的任务（带 agent 标记），「再跑一次」；换了 agent 会按你当时选的走
- **任务列表**：运行中 / 完成 / 失败 / 已中止、耗时，展开看日志尾部，3 秒轮询

面板只管「交给 agent」，不跑 shell 命令——那是我要用的能力（`outlive_run` 工具），不是这个页面的活。

面板不自己开端口，用的是宿主 web server 上的同源路由：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/__outlive/jobs` | `{ engines, defaultEngine, stateDir, jobs }` |
| GET | `/__outlive/log?id=…&tail=…` | 纯文本日志尾部（`id` 必须是 6–16 位小写字母数字，路径穿越直接被 400） |
| GET | `/__outlive/agents[?refresh=1]` | 可用 agent（含 bin 路径）+ 预设 + 手动添加的 |
| POST | `/__outlive/agents` | 添加：`{preset}` 或 `{name,bin,args,label?}` |
| POST | `/__outlive/agents/delete` | 移除手动添加的：`{name}` |
| GET | `/__outlive/tasks` | 常用任务列表 |
| POST | `/__outlive/tasks` | 存/改一条（`{command,label?,engine?,kind?}`，按内容+类型去重） |
| POST | `/__outlive/tasks/delete` | 删一条（`{id}`） |
| POST | `/__outlive/run` | 投递一条（`{command,engine?,label?,cwd?,taskId?,kind?}`） |

三条 `POST` 都要带 `x-outlive: 1` 头，且只接受 JSON 体（≤64 KiB）：网关已经管了"你是谁"，这个头管的是"这个请求来自面板"——跨站表单设不了自定义头。

手动添加的 agent 存在 `$OUTLIVE_HOME/agents.json`（默认 `~/runtime/outlive/agents.json`），一条形如 `{name,label,bin,args}`；`bin` 在添加时就被解析成绝对路径，之后 `command.sh` 里直接 `exec` 它（不依赖 PATH）。

### 执行器怎么选

`auto`（默认）= 探测顺序里的第一个可用；点名某个 agent 就只给它；点名但没装会明确报错，不会静默换人。

### 输入框里的 `/`

客户端注册了一个 `/` 触发源：在输入框打 `/`，候选里有一组「离场任务」——选一条，命令会以自然语言落进草稿（"用 outlive 跑这条命令：…"），你确认后发给我，我再投。选中不会直接执行，草稿仍然是你按发送键才发出去。

面板读状态时**故意不结算**（只 peek `exit` 标记、不写 `job.json`）：结算与"欠会话一条通知"是同一个动作，必须留给轮询循环做，否则面板一刷新就把那条通知吃掉。

`outlive_agent` 和内置 subagent 的区别：

- 内置 subagent 活在 dsh web 里，dsh 重启就一起没了，而且整段过程占着当前回合；
- `outlive_agent` 交出去就返回，你可以继续做别的，它跑完会来敲你（`followup`）。

适合自成一体、耗时、能独立验收的活。不适合需要中途盯着、频繁来回确认的活。

## 磁盘上是什么

```
~/runtime/outlive/<id>/
├── job.json      # 唯一事实源：状态、退出码、谁该收到通知（notices）
├── command.sh    # 你给的那段命令，单独一个文件
├── run.sh        # 运行器：cd / 记时间 / 跑 command.sh / 写退出标记
├── out.log       # stdout + stderr
├── exit          # "<code> <ms>"，最后一行写入
└── task.txt      # 仅 outlive_agent：完整任务描述
```

`exit` 标记的写法是核心：**空文件 = 还没跑完，有内容 = 结算了**。运行器最后才写它，所以"读不到内容"永远只意味着"还在跑"，不会把中断当成失败。取消时运行器会被一起杀掉，所以由取消方自己补写 `143`（128+SIGTERM）。

## 完成通知怎么回到会话

任务结束时如果会话还活着，插件给那个 agent 发一条 `followup`（用户消息），内容含状态、退出码、日志尾部。如果会话不在了，通知留在 `job.json` 的 `notices` 里；下次这个会话开起来（`agent/created`）时补发一次，且只补一次。

## 已知边界

- **只支持 systemd/Linux**。投递层是唯一 OS 相关的部分（`dispatch()`），要换 macOS/Windows 只需替换它。
- **唤醒需要会话自己在**。dsh web 完全没在跑时，没人会去读结果；先落盘，等它回来。
- **日志不轮转**。长跑任务的 `out.log` 会一直长，自己配 logrotate 或定期清理 `~/runtime/outlive/`。
- **面板是只读的**。看得到、看不了操作：要中止任务还是让模型调 `outlive_cancel`（保持一个写入口，省得界面和后端各写一遍状态）。
- **`outlive_agent` 的执行器**除三个内置之外，也可以在插件 config 里注册自己的（config 优先于内置）：

```yaml
- id: tool-outlive
  name: '@local/dsh-outlive'
  config:
    defaultEngine: codex
    engines:
      my-agent: (taskFile, title) => 'exec my-agent --prompt "$(cat <file>)"'
```

## 开发

```bash
node --check index.js
node test/smoke.mjs   # 离线：假 host、真 systemd unit、跨"重启"补发
```
