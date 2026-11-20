# dsh-outlive

给 DSH 一个"交出去就不管了"的执行面：任务跑在 harness 进程之外，重启不中断，结束时把结果送回会话。

## 为什么需要它

内置的后台任务（含 `bash` 的 `run_in_background`）都是 `dsh web` 的子进程。而最需要后台任务的时候，往往正是你要重启 dsh 的时候——重启服务、迁移、修 harness 自己。那一刻：

```
dsh web 重启 ──► 子进程全部消失 ──► 没有日志、没有退出码、不知道跑到哪一步
```

这个插件自己不执行任何东西。它写一个脚本，交给一个独立的 systemd 瞬态 unit（另一个 cgroup），之后只读磁盘：日志、退出标记、元数据。重启 dsh 只丢一个轮询循环，活还在跑，账还在记。

## 五个工具

| 工具 | 作用 |
|---|---|
| `outlive_run` | 把一条 shell 命令投递出去，立刻返回 id |
| `outlive_agent` | 把一整件任务交给离场编码 agent（默认 opencode） |
| `outlive_status` | 看状态、退出码、日志尾部（重启后照样能查） |
| `outlive_list` | 列出历史任务（跨重启） |
| `outlive_cancel` | 中止还在跑的任务 |

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
- **没有 UI 面板**。工具面 + 通知就够用了；要列表面板可以后加（`dsh-client-ui-*`）。
- **`outlive_agent` 的执行器**默认只有 opencode。别的在插件 config 里注册：

```yaml
- id: tool-outlive
  name: '@local/dsh-outlive'
  config:
    engines:
      my-agent: (taskFile, title) => 'exec my-agent --prompt "$(cat <file>)"'
```

## 开发

```bash
node --check index.js
node test/smoke.mjs   # 离线：假 host、真 systemd unit、跨"重启"补发
```
