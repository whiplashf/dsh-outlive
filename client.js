window.__ModuleLoader__.load({
  id: '@whiplashf/dsh-outlive',
  factory(require) {
    const React = require('react')
    const { createElement: h, Fragment, useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'outlive-panel'
    const POLL_MS = 3000
    const LOG_POLL_MS = 2000
    const NS = '@whiplashf/dsh-outlive'

    const EN = {
      'panel.title': 'Outlive',
      'panel.subtitle': 'Long jobs that outlive this session',
      'panel.refresh': 'Refresh',
      'panel.settings': 'Settings',
      'panel.running': '{count} running',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.delete': 'Delete',
      'common.browse': 'Browse…',
      'common.copy': 'Copy',
      'common.copied': 'Copied',
      'common.loading': 'Loading…',
      'common.none': 'None',
      'common.back': 'Back',
      'common.retry': 'Retry',
      'common.seconds': 'seconds',
      'status.running': 'Running',
      'status.completed': 'Completed',
      'status.failed': 'Failed',
      'status.cancelled': 'Cancelled',
      'compose.title': 'New job',
      'compose.tab.agent': 'Agent',
      'compose.tab.command': 'Command',
      'compose.tab.restart': 'Restart DSH',
      'compose.agent': 'Agent',
      'compose.agent.auto': 'Default ({name})',
      'compose.agent.none': 'Default (none ready)',
      'compose.task': 'Task',
      'compose.task.placeholder': 'What should the agent do? It cannot see this conversation, so include paths, context, and acceptance criteria.',
      'compose.command': 'Command',
      'compose.command.placeholder': 'Shell command, run with bash.',
      'compose.label': 'Label',
      'compose.label.placeholder': 'Shown in the job list',
      'compose.cwd': 'Working directory',
      'compose.cwd.placeholder': 'Defaults to the DSH working directory',
      'compose.runtime': 'Time limit',
      'compose.runtime.hint': 'Detached jobs are stopped after this many seconds.',
      'compose.preview': 'Show command',
      'compose.preview.hide': 'Hide command',
      'compose.advanced': 'Advanced',
      'compose.run': 'Run in background',
      'compose.save': 'Save as task',
      'compose.hint': 'Runs in a detached systemd unit. Closing this page or restarting DSH does not stop it.',
      'compose.restart.title': 'Restart DSH Web',
      'compose.restart.body': 'The restart runs outside this page. The page reconnects when the server is back.',
      'compose.restart.plan': 'Plan',
      'compose.restart.unitMode': 'Unit mode — systemd restarts {unit}.',
      'compose.restart.processMode': 'Process mode — the process is terminated and relaunched in a detached unit.',
      'compose.restart.ports': 'Health check: port {ports}',
      'compose.restart.unknown': 'The restart plan is available when the job is submitted.',
      'jobs.title': 'Jobs',
      'jobs.empty': 'No jobs yet.',
      'jobs.emptyFiltered': 'No jobs in this view.',
      'jobs.filter.all': 'All',
      'jobs.filter.running': 'Running',
      'jobs.filter.settled': 'Finished',
      'jobs.clear': 'Clear finished',
      'jobs.clearConfirm': 'Delete every finished job record?',
      'jobs.open': 'Open',
      'jobs.started': 'Started',
      'jobs.duration': 'Duration',
      'jobs.agent': 'Agent',
      'jobs.kind.agent': 'Agent',
      'jobs.kind.command': 'Command',
      'jobs.kind.restart': 'Restart',
      'job.cwd': 'Working directory',
      'job.command': 'Command',
      'job.log': 'Log',
      'job.exit': 'Exit code',
      'job.started': 'Started',
      'job.finished': 'Finished',
      'job.mode': 'Mode',
      'job.cancel': 'Cancel job',
      'job.delete': 'Delete record',
      'job.confirmDelete': 'Delete this record? The log is removed.',
      'job.noLog': 'No output yet.',
      'job.logTruncated': 'Showing the last 300 lines.',
      'tasks.title': 'Saved tasks',
      'tasks.empty': 'Saved tasks appear here.',
      'tasks.builtin': 'Built-in',
      'tasks.run': 'Run',
      'tasks.delete': 'Delete',
      'tasks.restore': 'Restore built-in task',
      'tasks.removed': 'The built-in task was removed.',
      'agents.title': 'Agents',
      'agents.manage': 'Manage agents',
      'agents.default': 'Default: {name}',
      'agents.none': 'No agent ready',
      'agents.ready': 'Ready',
      'agents.needsArguments': 'Needs arguments',
      'agents.notInstalled': 'Not installed',
      'agents.custom': 'Custom',
      'agents.unverified': 'Unverified',
      'settings.title': 'Settings',
      'settings.agents': 'Agents',
      'settings.agents.hint': 'Agents are detected on the host. Add an argument template only when the CLI needs one; {file} is replaced with the task file.',
      'settings.add': 'Add agent',
      'settings.name': 'Name',
      'settings.bin': 'Executable',
      'settings.args': 'Argument template',
      'settings.args.placeholder': '-p --dangerously-skip-permissions {file}',
      'settings.args.hint': 'Required token: {file}. Optional: {title}.',
      'settings.label': 'Display name',
      'settings.remove': 'Remove',
      'settings.removeConfirm': 'Remove this custom agent?',
      'settings.configure': 'Configure',
      'settings.verified': 'Verified',
      'settings.detected': 'Detected on this host',
      'settings.notDetected': 'Presets',
      'settings.stateDir': 'State directory',
      'settings.version': 'Version',
      'settings.builtin': 'Built-in task',
      'settings.builtin.removed': 'Removed',
      'settings.restore': 'Restore',
      'settings.added': 'Agent saved.',
      'settings.removed': 'Agent removed.',
      'dialog.agent.title': 'Choose agent executable',
      'dialog.cwd.title': 'Choose working directory',
      'dialog.path': 'Path',
      'dialog.filter': 'Filter',
      'dialog.showHidden': 'Show hidden',
      'dialog.executablesOnly': 'Executables only',
      'dialog.parent': 'Up',
      'dialog.select': 'Select',
      'dialog.selectDir': 'Select this folder',
      'dialog.empty': 'This folder is empty.',
      'dialog.places': 'Places',
      'dialog.denied': 'Permission denied.',
      'dialog.notFound': 'Folder not found.',
      'trigger.agent': 'Outlive agent',
      'trigger.agent.desc': 'Hand a task to a detached coding agent',
      'trigger.draft': 'Use Outlive to hand this to a detached coding agent (it runs outside this session and reports back here):',
      'trigger.draft.command': 'Run this through Outlive (detached from this session):',
      'error.badRequest': 'The request was rejected.',
      'error.forbidden': 'The panel request was not authorized.',
      'error.notFound': 'Not found.',
      'error.running': 'Stop the job before deleting its record.',
      'error.internal': 'The host reported an internal error.',
      'error.noneReady': 'No agent is ready. Install OpenCode, Codex, or Claude Code, or add a custom agent.',
      'error.needsArguments': 'This agent needs an argument template with {file}.',
      'error.notInstalled': 'This agent is not installed.',
      'error.unknown': 'Unknown agent.',
      'error.systemdMissing': 'systemd-run is not available on this host.',
      'error.cwdNotFound': 'The working directory does not exist.',
      'error.network': 'The Outlive API did not respond.',
      'error.preview': 'Could not build the command.',
      'notice.started': 'Job {id} started.',
      'notice.saved': 'Task saved.',
      'notice.deleted': 'Record deleted.',
      'notice.taskDeleted': 'Task deleted.',
      'error.invalidName': 'The name is invalid.',
      'error.binNotAbsolute': 'Choose an absolute path.',
      'error.binNotExecutable': 'That file is not executable.',
      'error.argsMissingFile': 'The argument template must include {file}.',
      'notice.cancelled': 'Job cancelled.',
      'notice.restored': 'Built-in task restored.',
      'notice.cleared': 'Finished records deleted.',
      'time.justNow': 'just now',
      'time.seconds': '{n}s ago',
      'time.minutes': '{n}m ago',
      'time.hours': '{n}h ago',
      'time.days': '{n}d ago',
    }

    const ZH = {
      'panel.title': 'Outlive',
      'panel.subtitle': '在会话之外运行的长任务',
      'panel.refresh': '刷新',
      'panel.settings': '设置',
      'panel.running': '{count} 个运行中',
      'common.close': '关闭',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.delete': '删除',
      'common.browse': '浏览…',
      'common.copy': '复制',
      'common.copied': '已复制',
      'common.loading': '加载中…',
      'common.none': '无',
      'common.back': '返回',
      'common.retry': '重试',
      'common.seconds': '秒',
      'status.running': '运行中',
      'status.completed': '已完成',
      'status.failed': '失败',
      'status.cancelled': '已中止',
      'compose.title': '新建任务',
      'compose.tab.agent': 'Agent',
      'compose.tab.command': '命令',
      'compose.tab.restart': '重启 DSH',
      'compose.agent': 'Agent',
      'compose.agent.auto': '默认（{name}）',
      'compose.agent.none': '默认（无可用 Agent）',
      'compose.task': '任务',
      'compose.task.placeholder': '要 Agent 做什么？它看不到这段对话，请写清路径、背景与验收标准。',
      'compose.command': '命令',
      'compose.command.placeholder': '用 bash 执行的 Shell 命令。',
      'compose.label': '标签',
      'compose.label.placeholder': '显示在任务列表',
      'compose.cwd': '工作目录',
      'compose.cwd.placeholder': '默认为 DSH 的工作目录',
      'compose.runtime': '时限',
      'compose.runtime.hint': '超过该秒数后，任务会被停止。',
      'compose.preview': '查看命令',
      'compose.preview.hide': '收起命令',
      'compose.advanced': '高级',
      'compose.run': '后台运行',
      'compose.save': '保存为常用任务',
      'compose.hint': '任务在独立的 systemd unit 中运行。关闭页面或重启 DSH 都不会中断。',
      'compose.restart.title': '重启 DSH Web',
      'compose.restart.body': '重启在本页之外执行；服务恢复后页面会自动重连。',
      'compose.restart.plan': '执行计划',
      'compose.restart.unitMode': 'Unit 模式 —— 由 systemd 重启 {unit}。',
      'compose.restart.processMode': '进程模式 —— 结束当前进程，并在独立 unit 中重新拉起。',
      'compose.restart.ports': '健康检查：端口 {ports}',
      'compose.restart.unknown': '提交任务时才能确定执行计划。',
      'jobs.title': '任务',
      'jobs.empty': '还没有任务。',
      'jobs.emptyFiltered': '当前视图没有任务。',
      'jobs.filter.all': '全部',
      'jobs.filter.running': '运行中',
      'jobs.filter.settled': '已结束',
      'jobs.clear': '清理已结束',
      'jobs.clearConfirm': '删除所有已结束任务的记录？',
      'jobs.open': '打开',
      'jobs.started': '开始',
      'jobs.duration': '用时',
      'jobs.agent': 'Agent',
      'jobs.kind.agent': 'Agent',
      'jobs.kind.command': '命令',
      'jobs.kind.restart': '重启',
      'job.cwd': '工作目录',
      'job.command': '命令',
      'job.log': '日志',
      'job.exit': '退出码',
      'job.started': '开始',
      'job.finished': '结束',
      'job.mode': '模式',
      'job.cancel': '中止任务',
      'job.delete': '删除记录',
      'job.confirmDelete': '删除这条记录？日志会一起删除。',
      'job.noLog': '暂无输出。',
      'job.logTruncated': '仅显示最后 300 行。',
      'tasks.title': '常用任务',
      'tasks.empty': '保存的任务会出现在这里。',
      'tasks.builtin': '内置',
      'tasks.run': '运行',
      'tasks.delete': '删除',
      'tasks.restore': '恢复内置任务',
      'tasks.removed': '内置任务已被删除。',
      'agents.title': 'Agent',
      'agents.manage': '管理 Agent',
      'agents.default': '默认：{name}',
      'agents.none': '没有可用的 Agent',
      'agents.ready': '可用',
      'agents.needsArguments': '需要参数',
      'agents.notInstalled': '未安装',
      'agents.custom': '自定义',
      'agents.unverified': '未核实',
      'settings.title': '设置',
      'settings.agents': 'Agent',
      'settings.agents.hint': 'Agent 从本机探测。仅当 CLI 需要参数模板时才需添加；{file} 会替换为任务文件。',
      'settings.add': '添加 Agent',
      'settings.name': '名称',
      'settings.bin': '可执行文件',
      'settings.args': '参数模板',
      'settings.args.placeholder': '-p --dangerously-skip-permissions {file}',
      'settings.args.hint': '必须包含 {file}，可选 {title}。',
      'settings.label': '显示名称',
      'settings.remove': '移除',
      'settings.removeConfirm': '移除此自定义 Agent？',
      'settings.configure': '配置',
      'settings.verified': '已核实',
      'settings.detected': '本机已安装',
      'settings.notDetected': '预设',
      'settings.stateDir': '状态目录',
      'settings.version': '版本',
      'settings.builtin': '内置任务',
      'settings.builtin.removed': '已删除',
      'settings.restore': '恢复',
      'settings.added': 'Agent 已保存。',
      'settings.removed': 'Agent 已移除。',
      'dialog.agent.title': '选择 Agent 可执行文件',
      'dialog.cwd.title': '选择工作目录',
      'dialog.path': '路径',
      'dialog.filter': '筛选',
      'dialog.showHidden': '显示隐藏项',
      'dialog.executablesOnly': '仅可执行文件',
      'dialog.parent': '上一级',
      'dialog.select': '选择',
      'dialog.selectDir': '选择此目录',
      'dialog.empty': '此目录为空。',
      'dialog.places': '位置',
      'dialog.denied': '没有访问权限。',
      'dialog.notFound': '目录不存在。',
      'trigger.agent': 'Outlive Agent',
      'trigger.agent.desc': '把任务交给离场的编码 Agent',
      'trigger.draft': '用 Outlive 把这件事交给离场的编码 Agent（在会话之外运行，结束后把结果送回本会话）：',
      'trigger.draft.command': '用 Outlive 投递这条命令（与当前会话分离）：',
      'error.badRequest': '请求被拒绝。',
      'error.forbidden': '面板请求未通过校验。',
      'error.notFound': '未找到。',
      'error.running': '请先中止任务，再删除记录。',
      'error.internal': '宿主返回内部错误。',
      'error.noneReady': '没有可用的 Agent。请安装 OpenCode、Codex 或 Claude Code，或添加自定义 Agent。',
      'error.needsArguments': '该 Agent 需要包含 {file} 的参数模板。',
      'error.notInstalled': '该 Agent 未安装。',
      'error.unknown': '未知 Agent。',
      'error.systemdMissing': '本机没有 systemd-run。',
      'error.cwdNotFound': '工作目录不存在。',
      'error.network': 'Outlive API 无响应。',
      'error.preview': '无法生成命令。',
      'notice.started': '任务 {id} 已启动。',
      'notice.saved': '任务已保存。',
      'notice.deleted': '记录已删除。',
      'notice.taskDeleted': '常用任务已删除。',
      'error.invalidName': '名称格式不正确。',
      'error.binNotAbsolute': '请选择绝对路径。',
      'error.binNotExecutable': '该文件不可执行。',
      'error.argsMissingFile': '参数模板必须包含 {file}。',
      'notice.cancelled': '任务已中止。',
      'notice.restored': '内置任务已恢复。',
      'notice.cleared': '已清理结束记录。',
      'time.justNow': '刚刚',
      'time.seconds': '{n} 秒前',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
    }

    const DICT = { en: EN, zh: ZH }

    function makeT(locale) {
      const dict = DICT[locale] || EN
      return (key, params) => {
        const template = dict[key] ?? EN[key] ?? key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? '' : String(params[name])))
      }
    }

    const CSS = `
      .outlive-page{width:100%;max-width:1120px;margin:0 auto;padding:28px 24px 56px;box-sizing:border-box;color:inherit;font-size:13px;line-height:1.5}
      .outlive-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .outlive-title{margin:0;font-size:22px;font-weight:640;letter-spacing:-.015em;line-height:1.2}
      .outlive-subtitle{margin:4px 0 0;opacity:.62;font-size:13px}
      .outlive-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .outlive-running{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid color-mix(in oklab,currentColor 16%,transparent);font-size:12px;opacity:.8}
      .outlive-running::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsh-accent,#4f8cff);box-shadow:0 0 0 3px color-mix(in oklab,var(--dsh-accent,#4f8cff) 18%,transparent)}
      .outlive-grid{display:grid;grid-template-columns:minmax(0,1fr) 344px;gap:20px;margin-top:24px;align-items:start}
      @media (max-width:980px){.outlive-grid{grid-template-columns:1fr}.outlive-side{order:3}}
      .outlive-main{display:flex;flex-direction:column;gap:20px;min-width:0}
      .outlive-side{display:flex;flex-direction:column;gap:16px;min-width:0}
      .outlive-card{border:1px solid color-mix(in oklab,currentColor 13%,transparent);border-radius:14px;background:color-mix(in oklab,currentColor 2.4%,transparent);padding:18px;min-width:0}
      .outlive-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
      .outlive-card-title{margin:0;font-size:14px;font-weight:620;letter-spacing:-.005em}
      .outlive-card-note{margin:0;font-size:12px;opacity:.62}
      .outlive-tabs{display:flex;gap:4px;padding:3px;border-radius:10px;background:color-mix(in oklab,currentColor 6%,transparent);width:fit-content;max-width:100%;flex-wrap:wrap}
      .outlive-tab{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;cursor:pointer;opacity:.72}
      .outlive-tab[aria-selected="true"]{background:color-mix(in oklab,currentColor 12%,transparent);opacity:1;font-weight:560}
      .outlive-tab:hover{opacity:1}
      .outlive-field{display:flex;flex-direction:column;gap:6px;min-width:0}
      .outlive-label{font-size:12px;font-weight:560;opacity:.78}
      .outlive-input,.outlive-select,.outlive-textarea{width:100%;box-sizing:border-box;border:1px solid color-mix(in oklab,currentColor 16%,transparent);border-radius:9px;background:color-mix(in oklab,currentColor 3%,transparent);color:inherit;font:inherit;font-size:13px;padding:8px 10px;outline:none}
      .outlive-input:focus,.outlive-select:focus,.outlive-textarea:focus{border-color:color-mix(in oklab,var(--dsh-accent,#4f8cff) 60%,transparent);box-shadow:0 0 0 3px color-mix(in oklab,var(--dsh-accent,#4f8cff) 14%,transparent)}
      .outlive-textarea{resize:vertical;min-height:116px;line-height:1.55}
      .outlive-textarea.mono,.outlive-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
      .outlive-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
      .outlive-row>.outlive-field{flex:1 1 180px}
      .outlive-row>.outlive-field.small{flex:0 0 120px}
      .outlive-compose{display:flex;flex-direction:column;gap:14px}
      .outlive-hint{font-size:12px;opacity:.6;margin:0}
      .outlive-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .outlive-spacer{flex:1 1 auto}
      .outlive-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid color-mix(in oklab,currentColor 18%,transparent);background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:540;padding:7px 12px;border-radius:9px;cursor:pointer;white-space:nowrap;line-height:1.3}
      .outlive-btn:hover{background:color-mix(in oklab,currentColor 7%,transparent)}
      .outlive-btn:disabled{opacity:.45;cursor:not-allowed}
      .outlive-btn.primary{background:var(--dsh-accent,#4f8cff);border-color:transparent;color:#fff}
      .outlive-btn.primary:hover{filter:brightness(1.06)}
      .outlive-btn.danger{color:#e5484d;border-color:color-mix(in oklab,#e5484d 40%,transparent)}
      .outlive-btn.ghost{border-color:transparent}
      .outlive-btn.small{padding:4px 9px;font-size:11px}
      .outlive-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer}
      .outlive-icon-btn:hover{background:color-mix(in oklab,currentColor 8%,transparent);border-color:color-mix(in oklab,currentColor 12%,transparent)}
      .outlive-btn:focus-visible,.outlive-icon-btn:focus-visible,.outlive-tab:focus-visible,.outlive-input:focus-visible,.outlive-select:focus-visible,.outlive-textarea:focus-visible,.outlive-fs-row:focus-visible{outline:2px solid var(--dsh-accent,#4f8cff);outline-offset:2px}
      .outlive-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:560;border:1px solid transparent;white-space:nowrap}
      .outlive-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
      .outlive-pill.running{color:var(--dsh-accent,#4f8cff);border-color:color-mix(in oklab,var(--dsh-accent,#4f8cff) 34%,transparent);background:color-mix(in oklab,var(--dsh-accent,#4f8cff) 9%,transparent)}
      .outlive-pill.completed{color:#2f9e44;border-color:color-mix(in oklab,#2f9e44 32%,transparent);background:color-mix(in oklab,#2f9e44 9%,transparent)}
      .outlive-pill.failed{color:#e5484d;border-color:color-mix(in oklab,#e5484d 32%,transparent);background:color-mix(in oklab,#e5484d 9%,transparent)}
      .outlive-pill.cancelled{color:color-mix(in oklab,currentColor 62%,transparent);border-color:color-mix(in oklab,currentColor 18%,transparent)}
      .outlive-badge{display:inline-flex;align-items:center;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:600;letter-spacing:.01em;border:1px solid color-mix(in oklab,currentColor 18%,transparent);opacity:.82;white-space:nowrap}
      .outlive-badge.accent{color:var(--dsh-accent,#4f8cff);border-color:color-mix(in oklab,var(--dsh-accent,#4f8cff) 34%,transparent)}
      .outlive-badge.warn{color:#c47d00;border-color:color-mix(in oklab,#c47d00 34%,transparent)}
      .outlive-jobs{display:flex;flex-direction:column;gap:2px}
      .outlive-job{border-radius:10px;border:1px solid transparent}
      .outlive-job+.outlive-job{border-top-color:color-mix(in oklab,currentColor 8%,transparent);border-radius:0}
      .outlive-job.open{background:color-mix(in oklab,currentColor 3%,transparent);border-color:color-mix(in oklab,currentColor 10%,transparent);border-radius:10px;margin:4px 0}
      .outlive-job-row{display:grid;grid-template-columns:74px minmax(0,1fr) 104px 96px 24px;gap:10px;align-items:center;padding:9px 8px;cursor:pointer;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left}
      .outlive-job-row:hover{background:color-mix(in oklab,currentColor 4%,transparent);border-radius:10px}
      @media (max-width:720px){.outlive-job-row{grid-template-columns:74px minmax(0,1fr) 24px}.outlive-job-row .col-agent,.outlive-job-row .col-time{display:none}}
      .outlive-job-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:520}
      .outlive-job-meta{font-size:11px;opacity:.56;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-job-agent,.outlive-job-time{font-size:11px;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .outlive-chevron{opacity:.45;font-size:11px;text-align:center}
      .outlive-detail{padding:2px 10px 12px 92px;display:flex;flex-direction:column;gap:10px}
      @media (max-width:720px){.outlive-detail{padding-left:10px}}
      .outlive-kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:4px 12px;font-size:12px}
      .outlive-kv dt{opacity:.58}
      .outlive-kv dd{margin:0;overflow-wrap:anywhere}
      .outlive-pre{margin:0;padding:10px 12px;border-radius:9px;background:color-mix(in oklab,currentColor 4%,transparent);border:1px solid color-mix(in oklab,currentColor 9%,transparent);max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5}
      .outlive-pre.tall{max-height:340px}
      .outlive-emptystate{border:1px dashed color-mix(in oklab,currentColor 16%,transparent);border-radius:10px;padding:18px;text-align:center;font-size:12px;opacity:.62}
      .outlive-task{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid color-mix(in oklab,currentColor 8%,transparent)}
      .outlive-task:first-child{border-top:0}
      .outlive-task-main{min-width:0;flex:1}
      .outlive-task-label{font-size:12px;font-weight:540;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-task-meta{font-size:11px;opacity:.56;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
      .outlive-agent-row{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid color-mix(in oklab,currentColor 8%,transparent)}
      .outlive-agent-row:first-child{border-top:0}
      .outlive-agent-main{min-width:0;flex:1}
      .outlive-agent-name{font-size:12px;font-weight:560;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .outlive-agent-path{font-size:10.5px;opacity:.52;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
      .outlive-agent-args{font-size:10.5px;opacity:.62;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-plan{display:flex;flex-direction:column;gap:6px;font-size:12px}
      .outlive-plan-line{display:flex;gap:8px;align-items:baseline}
      .outlive-plan-line b{font-weight:560;opacity:.7;min-width:52px}
      .outlive-notice{display:flex;align-items:flex-start;gap:8px;border-radius:9px;padding:8px 10px;font-size:12px;border:1px solid color-mix(in oklab,currentColor 14%,transparent);background:color-mix(in oklab,currentColor 3%,transparent)}
      .outlive-notice.error{color:#e5484d;border-color:color-mix(in oklab,#e5484d 34%,transparent);background:color-mix(in oklab,#e5484d 7%,transparent)}
      .outlive-overlay{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in oklab,#000 42%,transparent)}
      .outlive-dialog{width:min(760px,100%);max-height:min(720px,88vh);display:flex;flex-direction:column;border-radius:14px;border:1px solid color-mix(in oklab,currentColor 16%,transparent);background:color-mix(in oklab,currentColor 7%,transparent);backdrop-filter:blur(18px);color:inherit;box-shadow:0 24px 80px rgba(0,0,0,.4);overflow:hidden}
      .outlive-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid color-mix(in oklab,currentColor 10%,transparent)}
      .outlive-dialog-body{display:grid;grid-template-columns:180px minmax(0,1fr);min-height:0;flex:1}
      @media (max-width:640px){.outlive-dialog-body{grid-template-columns:1fr}.outlive-fs-places{display:none}}
      .outlive-fs-places{border-right:1px solid color-mix(in oklab,currentColor 10%,transparent);padding:10px;overflow:auto}
      .outlive-fs-places-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;opacity:.45;padding:4px 6px}
      .outlive-fs-place{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-fs-place:hover{background:color-mix(in oklab,currentColor 7%,transparent)}
      .outlive-fs-main{display:flex;flex-direction:column;min-height:0}
      .outlive-fs-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid color-mix(in oklab,currentColor 8%,transparent);flex-wrap:wrap}
      .outlive-crumbs{display:flex;align-items:center;gap:2px;flex-wrap:wrap;font-size:11.5px;min-width:0;flex:1 1 220px;overflow:hidden}
      .outlive-crumb{border:0;background:transparent;color:inherit;font:inherit;font-size:11.5px;padding:2px 5px;border-radius:5px;cursor:pointer;opacity:.72;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-crumb:hover{background:color-mix(in oklab,currentColor 7%,transparent);opacity:1}
      .outlive-crumb-sep{opacity:.3}
      .outlive-fs-list{flex:1;overflow:auto;min-height:220px;max-height:46vh;padding:6px}
      .outlive-fs-row{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;padding:7px 9px;border-radius:8px;cursor:pointer}
      .outlive-fs-row:hover{background:color-mix(in oklab,currentColor 6%,transparent)}
      .outlive-fs-row.selected{background:color-mix(in oklab,var(--dsh-accent,#4f8cff) 14%,transparent)}
      .outlive-fs-row:disabled{opacity:.4;cursor:default}
      .outlive-fs-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .outlive-fs-kind{font-size:10px;opacity:.42}
      .outlive-dialog-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid color-mix(in oklab,currentColor 10%,transparent);flex-wrap:wrap}
      .outlive-drawer{position:fixed;top:0;right:0;bottom:0;z-index:80;width:min(460px,100%);background:color-mix(in oklab,currentColor 7%,transparent);backdrop-filter:blur(18px);color:inherit;border-left:1px solid color-mix(in oklab,currentColor 14%,transparent);box-shadow:-20px 0 60px rgba(0,0,0,.28);display:flex;flex-direction:column}
      .outlive-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid color-mix(in oklab,currentColor 10%,transparent)}
      .outlive-drawer-body{padding:16px 18px 28px;overflow:auto;display:flex;flex-direction:column;gap:18px}
      .outlive-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.07em;opacity:.5;margin:0 0 8px}
      .outlive-form{display:flex;flex-direction:column;gap:10px;border:1px solid color-mix(in oklab,currentColor 12%,transparent);border-radius:10px;padding:12px;margin-top:10px}
      .outlive-check{display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.75;white-space:nowrap}
      .outlive-topnote{display:flex;gap:8px;align-items:center;font-size:11.5px;opacity:.62;margin-top:10px}
      .outlive-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in oklab,currentColor 22%,transparent);border-top-color:currentColor;animation:outlive-spin .8s linear infinite}
      @keyframes outlive-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.outlive-spin{animation:none}}
      .outlive-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    `

    function Icon({ name, size = 15 }) {
      const paths = {
        refresh: h('path', { d: 'M3 8a5 5 0 1 1 1.5 3.5M3 4v4h4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        settings: h('path', { d: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm5.2-2.2c0 .3 0 .6-.1.9l1.4 1.1-1.3 2.2-1.6-.6c-.5.4-1 .7-1.6.9l-.2 1.7H7.2l-.2-1.7c-.6-.2-1.1-.5-1.6-.9l-1.6.6-1.3-2.2L4 9c0-.3-.1-.6-.1-.9s0-.6.1-.9L2.6 6.1l1.3-2.2 1.6.6c.5-.4 1-.7 1.6-.9l.2-1.7h2.6l.2 1.7c.6.2 1.1.5 1.6.9l1.6-.6 1.3 2.2-1.4 1.1c.1.3.1.6.1.9Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        close: h('path', { d: 'm4 4 8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        folder: h('path', { d: 'M2 5.5A1.5 1.5 0 0 1 3.5 4h3l1.2 1.5h5.3A1.5 1.5 0 0 1 14.5 7v4.5A1.5 1.5 0 0 1 13 13H3.5A1.5 1.5 0 0 1 2 11.5v-6Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        file: h('path', { d: 'M4 2.5h5l3 3v8H4v-11Zm5 0v3h3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        up: h('path', { d: 'M8 3v10M4 7l4-4 4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        run: h('path', { d: 'M4 3.5v9l8-4.5-8-4.5Z', fill: 'currentColor' }),
        trash: h('path', { d: 'M4 5h8M6 5V3.5h4V5m-5 0 .5 8h5L11 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        check: h('path', { d: 'm3 8 3.2 3.2L13 4.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        chevron: h('path', { d: 'm6 4 4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      }
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
        paths[name] || null,
      )
    }

    function OutliveIcon(props) {
      return h(
        'svg',
        { width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', ...props },
        h('path', {
          d: 'M3 11.5 21 3l-8.5 18-2.4-7.1L3 11.5Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M10.1 13.9 21 3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    async function request(path, options = {}) {
      const method = options.method || 'GET'
      const headers = { 'x-outlive': '1' }
      if (method !== 'GET') headers['content-type'] = 'application/json'
      let response
      try {
        response = await fetch(path, {
          method,
          headers,
          cache: 'no-store',
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        })
      } catch (error) {
        const wrapped = new Error('network')
        wrapped.code = 'network'
        throw wrapped
      }
      const raw = await response.text()
      let data = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }
      if (!response.ok) {
        const error = new Error(data.error || `HTTP ${response.status}`)
        error.code = data.error || 'badRequest'
        error.detail = data.detail
        error.status = response.status
        throw error
      }
      return data
    }

    function errorMessage(t, error) {
      if (!error) return ''
      const code = error.code || 'badRequest'
      const known = [
        'badRequest',
        'forbidden',
        'notFound',
        'running',
        'internal',
        'noneReady',
        'needsArguments',
        'notInstalled',
        'unknown',
        'systemdMissing',
        'cwdNotFound',
        'network',
        'invalidName',
        'binNotAbsolute',
        'binNotExecutable',
        'argsMissingFile',
      ]
      if (known.includes(code)) return t(`error.${code}`)
      return error.detail || error.message || t('error.badRequest')
    }

    function formatAgo(iso, t) {
      const then = Date.parse(iso || '')
      if (!Number.isFinite(then)) return ''
      const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
      if (seconds < 45) return t('time.justNow')
      if (seconds < 60) return t('time.seconds', { n: seconds })
      if (seconds < 3600) return t('time.minutes', { n: Math.max(1, Math.floor(seconds / 60)) })
      if (seconds < 86400) return t('time.hours', { n: Math.floor(seconds / 3600) })
      return t('time.days', { n: Math.floor(seconds / 86400) })
    }

    function formatDuration(startedAt, finishedAt) {
      const start = Date.parse(startedAt || '')
      const end = Date.parse(finishedAt || new Date().toISOString())
      if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
      const seconds = Math.max(0, Math.round((end - start) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      if (minutes < 60) return `${minutes}m${rest ? ` ${rest}s` : ''}`
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }

    function StatusPill({ status, t }) {
      return h('span', { className: `outlive-pill ${status}` }, t(`status.${status}`))
    }

    function Notice({ notice, onClose }) {
      if (!notice) return null
      return h(
        'div',
        { className: `outlive-notice${notice.kind === 'error' ? ' error' : ''}`, role: 'status' },
        h('span', { style: { flex: '1 1 auto' } }, notice.text),
        h('button', { type: 'button', className: 'outlive-icon-btn', onClick: onClose, 'aria-label': 'Dismiss' }, h(Icon, { name: 'close', size: 12 })),
      )
    }

    function FileDialog({ t, mode, initialPath, onPick, onClose }) {
      const [path, setPath] = useState(initialPath || '')
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [filter, setFilter] = useState('')
      const [showHidden, setShowHidden] = useState(false)
      const [executablesOnly, setExecutablesOnly] = useState(mode === 'file')
      const [selected, setSelected] = useState(null)
      const panelRef = useRef(null)

      const load = useCallback(
        async (target) => {
          setLoading(true)
          setError(null)
          try {
            const query = new URLSearchParams({ path: target || '', showHidden: showHidden ? '1' : '0', executablesOnly: executablesOnly ? '1' : '0' })
            const result = await request(`/api/outlive/fs?${query}`)
            setData(result)
            setPath(result.path)
            setSelected(null)
          } catch (err) {
            setError(errorMessage(t, err))
          } finally {
            setLoading(false)
          }
        },
        [showHidden, executablesOnly, t],
      )

      useEffect(() => {
        load(path)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [showHidden, executablesOnly])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const entries = useMemo(() => {
        if (!data) return []
        const term = filter.trim().toLowerCase()
        return data.entries.filter((entry) => !term || entry.name.toLowerCase().includes(term))
      }, [data, filter])

      const crumbs = useMemo(() => {
        const current = data?.path || path || '/'
        const parts = current.split('/').filter(Boolean)
        const out = [{ label: '/', path: '/' }]
        let acc = ''
        for (const part of parts) {
          acc += `/${part}`
          out.push({ label: part, path: acc })
        }
        return out
      }, [data, path])

      const canSelect = mode === 'dir' ? Boolean(data?.path) : Boolean(selected && !selected.dir)

      const select = () => {
        if (mode === 'dir') {
          onPick(data.path)
        } else if (selected && !selected.dir) {
          onPick(selected.path)
        }
      }

      return h(
        'div',
        { className: 'outlive-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h(
          'div',
          { className: 'outlive-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': mode === 'dir' ? t('dialog.cwd.title') : t('dialog.agent.title'), ref: panelRef },
          h(
            'div',
            { className: 'outlive-dialog-head' },
            h('strong', { style: { fontSize: 14 } }, mode === 'dir' ? t('dialog.cwd.title') : t('dialog.agent.title')),
            h('button', { type: 'button', className: 'outlive-icon-btn', onClick: onClose, 'aria-label': t('common.close') }, h(Icon, { name: 'close' })),
          ),
          h(
            'div',
            { className: 'outlive-fs-toolbar' },
            h('button', { type: 'button', className: 'outlive-icon-btn', disabled: !data?.parent, onClick: () => load(data?.parent), 'aria-label': t('dialog.parent') }, h(Icon, { name: 'up' })),
            h(
              'div',
              { className: 'outlive-crumbs' },
              crumbs.map((crumb, index) =>
                h(
                  Fragment,
                  { key: crumb.path },
                  index > 0 ? h('span', { className: 'outlive-crumb-sep' }, '/') : null,
                  h('button', { type: 'button', className: 'outlive-crumb', onClick: () => load(crumb.path), title: crumb.path }, crumb.label),
                ),
              ),
            ),
            h('input', { className: 'outlive-input', style: { flex: '0 1 160px', width: 160 }, placeholder: t('dialog.filter'), value: filter, onChange: (event) => setFilter(event.target.value) }),
            h('label', { className: 'outlive-check' }, h('input', { type: 'checkbox', checked: showHidden, onChange: (event) => setShowHidden(event.target.checked) }), t('dialog.showHidden')),
            mode === 'file'
              ? h('label', { className: 'outlive-check' }, h('input', { type: 'checkbox', checked: executablesOnly, onChange: (event) => setExecutablesOnly(event.target.checked) }), t('dialog.executablesOnly'))
              : null,
          ),
          h(
            'div',
            { className: 'outlive-dialog-body' },
            h(
              'div',
              { className: 'outlive-fs-places' },
              h('div', { className: 'outlive-fs-places-title' }, t('dialog.places')),
              (data?.places || []).map((place) =>
                h('button', { key: place.path, type: 'button', className: 'outlive-fs-place', title: place.path, onClick: () => load(place.path) }, place.label),
              ),
            ),
            h(
              'div',
              { className: 'outlive-fs-main' },
              h(
                'div',
                { className: 'outlive-fs-list' },
                loading ? h('div', { className: 'outlive-emptystate' }, h('span', { className: 'outlive-spin' })) : null,
                error ? h('div', { className: 'outlive-emptystate' }, error) : null,
                !loading && !error && !entries.length ? h('div', { className: 'outlive-emptystate' }, t('dialog.empty')) : null,
                !loading && !error
                  ? entries.map((entry) =>
                      h(
                        'button',
                        {
                          key: entry.path,
                          type: 'button',
                          className: `outlive-fs-row${selected?.path === entry.path ? ' selected' : ''}`,
                          onClick: () => setSelected(entry),
                          onDoubleClick: () => (entry.dir ? load(entry.path) : select()),
                        },
                        h(Icon, { name: entry.dir ? 'folder' : 'file', size: 14 }),
                        h('span', { className: 'outlive-fs-name' }, entry.name),
                        h('span', { className: 'outlive-fs-kind' }, entry.dir ? '' : entry.executable ? 'exec' : ''),
                      ),
                    )
                  : null,
              ),
            ),
          ),
          h(
            'div',
            { className: 'outlive-dialog-foot' },
            h('span', { className: 'outlive-hint', style: { minWidth: 0, overflowWrap: 'anywhere' } }, selected?.path || data?.path || ''),
            h(
              'div',
              { className: 'outlive-actions' },
              h('button', { type: 'button', className: 'outlive-btn', onClick: onClose }, t('common.cancel')),
              h('button', { type: 'button', className: 'outlive-btn primary', disabled: !canSelect, onClick: select }, mode === 'dir' ? t('dialog.selectDir') : t('dialog.select')),
            ),
          ),
        ),
      )
    }

    function SettingsDrawer({ t, data, onClose, onChanged, notify }) {
      const [form, setForm] = useState({ name: '', label: '', bin: '', args: '' })
      const [dialog, setDialog] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [confirmRemove, setConfirmRemove] = useState(null)

      const add = async () => {
        setBusy(true)
        setError(null)
        try {
          await request('/api/outlive/agents', {
            method: 'POST',
            body: { name: form.name.trim(), label: form.label.trim(), bin: form.bin, args: form.args },
          })
          setForm({ name: '', label: '', bin: '', args: '' })
          notify(t('settings.added'), 'ok')
          onChanged()
        } catch (err) {
          setError(errorMessage(t, err))
        } finally {
          setBusy(false)
        }
      }

      const remove = async (name) => {
        setBusy(true)
        setError(null)
        try {
          await request('/api/outlive/agents/delete', { method: 'POST', body: { name } })
          setConfirmRemove(null)
          notify(t('settings.removed'), 'ok')
          onChanged()
        } catch (err) {
          setError(errorMessage(t, err))
        } finally {
          setBusy(false)
        }
      }

      const restore = async () => {
        setBusy(true)
        try {
          await request('/api/outlive/tasks/restore', { method: 'POST', body: { key: 'restart-dsh' } })
          notify(t('notice.restored'), 'ok')
          onChanged()
        } catch (err) {
          setError(errorMessage(t, err))
        } finally {
          setBusy(false)
        }
      }

      const configure = (agent) => {
        setForm({ name: agent.name, label: agent.label || agent.name, bin: agent.bin || '', args: agent.args || '' })
      }

      const removedBuiltin = (data?.builtins?.removed || []).includes('restart-dsh')

      return h(
        Fragment,
        null,
        h(
          'aside',
          { className: 'outlive-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('settings.title') },
          h(
            'div',
            { className: 'outlive-drawer-head' },
            h('strong', { style: { fontSize: 14 } }, t('settings.title')),
            h('button', { type: 'button', className: 'outlive-icon-btn', onClick: onClose, 'aria-label': t('common.close') }, h(Icon, { name: 'close' })),
          ),
          h(
            'div',
            { className: 'outlive-drawer-body' },
            error ? h(Notice, { notice: { kind: 'error', text: error }, onClose: () => setError(null) }) : null,
            h(
              'section',
              null,
              h('h3', { className: 'outlive-section-title' }, t('settings.detected')),
              h(
                'div',
                null,
                (data?.agents?.list || []).map((agent) =>
                  h(
                    'div',
                    { key: agent.name, className: 'outlive-agent-row' },
                    h(
                      'div',
                      { className: 'outlive-agent-main' },
                      h(
                        'div',
                        { className: 'outlive-agent-name' },
                        agent.label || agent.name,
                        agent.source === 'custom' ? h('span', { className: 'outlive-badge accent' }, t('agents.custom')) : null,
                        agent.verified ? h('span', { className: 'outlive-badge' }, h(Icon, { name: 'check', size: 9 }), t('settings.verified')) : h('span', { className: 'outlive-badge warn' }, t('agents.unverified')),
                        !agent.installed ? h('span', { className: 'outlive-badge' }, t('agents.notInstalled')) : null,
                        agent.installed && !agent.ready ? h('span', { className: 'outlive-badge warn' }, t('agents.needsArguments')) : null,
                      ),
                      h('div', { className: 'outlive-agent-path', title: agent.bin || '' }, agent.bin || ''),
                      agent.version ? h('div', { className: 'outlive-agent-path' }, agent.version) : null,
                      agent.args ? h('div', { className: 'outlive-agent-args', title: agent.args }, agent.args) : null,
                    ),
                    agent.source === 'custom'
                      ? confirmRemove === agent.name
                        ? h(
                            'div',
                            { className: 'outlive-actions' },
                            h('button', { type: 'button', className: 'outlive-btn small danger', disabled: busy, onClick: () => remove(agent.name) }, t('settings.remove')),
                            h('button', { type: 'button', className: 'outlive-btn small', onClick: () => setConfirmRemove(null) }, t('common.cancel')),
                          )
                        : h(
                            'div',
                            { className: 'outlive-actions' },
                            h('button', { type: 'button', className: 'outlive-btn small', onClick: () => configure(agent) }, t('settings.configure')),
                            h('button', { type: 'button', className: 'outlive-btn small danger', onClick: () => setConfirmRemove(agent.name) }, t('settings.remove')),
                          )
                      : agent.installed && !agent.ready
                        ? h('button', { type: 'button', className: 'outlive-btn small', onClick: () => configure(agent) }, t('settings.configure'))
                        : null,
                  ),
                ),
              ),
            ),
            h(
              'section',
              null,
              h('h3', { className: 'outlive-section-title' }, t('settings.add')),
              h('p', { className: 'outlive-hint' }, t('settings.agents.hint')),
              h(
                'div',
                { className: 'outlive-form' },
                h(
                  'div',
                  { className: 'outlive-row' },
                  h(
                    'label',
                    { className: 'outlive-field' },
                    h('span', { className: 'outlive-label' }, t('settings.name')),
                    h('input', { className: 'outlive-input', value: form.name, placeholder: 'my-agent', onChange: (event) => setForm({ ...form, name: event.target.value }) }),
                  ),
                  h(
                    'label',
                    { className: 'outlive-field' },
                    h('span', { className: 'outlive-label' }, t('settings.label')),
                    h('input', { className: 'outlive-input', value: form.label, placeholder: '', onChange: (event) => setForm({ ...form, label: event.target.value }) }),
                  ),
                ),
                h(
                  'label',
                  { className: 'outlive-field' },
                  h('span', { className: 'outlive-label' }, t('settings.bin')),
                  h(
                    'div',
                    { className: 'outlive-row', style: { alignItems: 'center' } },
                    h('input', { className: 'outlive-input', value: form.bin, readOnly: true, placeholder: '/usr/local/bin/my-agent' }),
                    h('button', { type: 'button', className: 'outlive-btn', onClick: () => setDialog(true) }, t('common.browse')),
                  ),
                ),
                h(
                  'label',
                  { className: 'outlive-field' },
                  h('span', { className: 'outlive-label' }, t('settings.args')),
                  h('textarea', {
                    className: 'outlive-textarea mono',
                    style: { minHeight: 72 },
                    value: form.args,
                    placeholder: t('settings.args.placeholder'),
                    onChange: (event) => setForm({ ...form, args: event.target.value }),
                  }),
                  h('span', { className: 'outlive-hint' }, t('settings.args.hint')),
                ),
                h(
                  'div',
                  { className: 'outlive-actions' },
                  h('button', { type: 'button', className: 'outlive-btn primary', disabled: busy || !form.name || !form.bin || !form.args, onClick: add }, t('common.save')),
                ),
              ),
            ),
            h(
              'section',
              null,
              h('h3', { className: 'outlive-section-title' }, t('settings.builtin')),
              removedBuiltin
                ? h(
                    'div',
                    { className: 'outlive-actions' },
                    h('span', { className: 'outlive-hint' }, t('tasks.removed')),
                    h('button', { type: 'button', className: 'outlive-btn', disabled: busy, onClick: restore }, t('settings.restore')),
                  )
                : h('p', { className: 'outlive-hint' }, t('compose.restart.title')),
            ),
            h(
              'section',
              null,
              h('h3', { className: 'outlive-section-title' }, 'Info'),
              h('dl', { className: 'outlive-kv' },
                h('dt', null, t('settings.stateDir')),
                h('dd', { className: 'outlive-mono' }, data?.stateDir || '—'),
                h('dt', null, t('settings.version')),
                h('dd', null, data?.version || '—'),
              ),
            ),
          ),
        ),
        dialog
          ? h(FileDialog, {
              t,
              mode: 'file',
              initialPath: form.bin ? form.bin.slice(0, form.bin.lastIndexOf('/')) : '',
              onClose: () => setDialog(false),
              onPick: (path) => {
                const name = path.split('/').pop() || ''
                setForm((current) => ({ ...current, bin: path, name: current.name || name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase() }))
                setDialog(false)
              },
            })
          : null,
      )
    }

    function AgentSelect({ t, agents, value, onChange }) {
      const ready = agents.filter((agent) => agent.ready)
      const options = [{ value: 'auto', label: agents.default ? t('compose.agent.auto', { name: agents.default }) : t('compose.agent.none') }]
      for (const agent of agents) {
        const state = agent.ready ? '' : agent.installed ? ` — ${t('agents.needsArguments')}` : ` — ${t('agents.notInstalled')}`
        options.push({ value: agent.name, label: `${agent.label || agent.name}${state}`, disabled: !agent.ready })
      }
      return h(
        'select',
        { className: 'outlive-select', value, onChange: (event) => onChange(event.target.value) },
        options.map((option) => h('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label)),
      )
    }

    function JobDetail({ t, job, log, onCancel, onDelete, busy }) {
      const [copied, setCopied] = useState(false)
      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          setCopied(false)
        }
      }
      return h(
        'div',
        { className: 'outlive-detail' },
        h(
          'dl',
          { className: 'outlive-kv' },
          h('dt', null, t('job.command')),
          h('dd', { className: 'outlive-mono' }, job.command || '—'),
          job.cwd ? h('dt', null, t('job.cwd')) : null,
          job.cwd ? h('dd', { className: 'outlive-mono' }, job.cwd) : null,
          job.kind === 'restart' ? h('dt', null, t('job.mode')) : null,
          job.kind === 'restart' ? h('dd', null, job.mode || '—') : null,
          job.exitCode !== null ? h('dt', null, t('job.exit')) : null,
          job.exitCode !== null ? h('dd', null, String(job.exitCode)) : null,
          job.error ? h('dt', null, 'Error') : null,
          job.error ? h('dd', null, job.error) : null,
        ),
        h(
          'div',
          { className: 'outlive-actions' },
          job.status === 'running' ? h('button', { type: 'button', className: 'outlive-btn small danger', disabled: busy, onClick: () => onCancel(job) }, t('job.cancel')) : null,
          h(
            'button',
            { type: 'button', className: 'outlive-btn small', disabled: busy || job.status === 'running', onClick: () => onDelete(job) },
            t('job.delete'),
          ),
          job.command ? h('button', { type: 'button', className: 'outlive-btn small ghost', onClick: () => copy(job.command) }, copied ? t('common.copied') : t('common.copy')) : null,
        ),
        h('div', null,
          h('div', { className: 'outlive-label', style: { marginBottom: 6 } }, t('job.log')),
          h('pre', { className: 'outlive-pre tall' }, log === null ? t('common.loading') : log || t('job.noLog')),
        ),
      )
    }

    function Composer({ t, lang, agents, onChanged, notify }) {
      const [tab, setTab] = useState('agent')
      const [task, setTask] = useState('')
      const [command, setCommand] = useState('')
      const [agent, setAgent] = useState('auto')
      const [label, setLabel] = useState('')
      const [cwd, setCwd] = useState('')
      const [runtime, setRuntime] = useState(7200)
      const [preview, setPreview] = useState(null)
      const [previewOpen, setPreviewOpen] = useState(false)
      const [plan, setPlan] = useState(null)
      const [planOpen, setPlanOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [dialog, setDialog] = useState(false)

      const loadPlan = useCallback(async () => {
        try {
          const result = await request('/api/outlive/preview', { method: 'POST', body: { kind: 'restart' } })
          setPlan(result)
        } catch {
          setPlan(null)
        }
      }, [])

      useEffect(() => {
        if (tab === 'restart') loadPlan()
      }, [tab, loadPlan])

      const showPreview = async () => {
        if (previewOpen) {
          setPreviewOpen(false)
          return
        }
        setError(null)
        try {
          const body =
            tab === 'command'
              ? { kind: 'command', command }
              : { kind: 'agent', task, agent, label }
          const result = await request('/api/outlive/preview', { method: 'POST', body })
          setPreview(result.command || '')
          setPreviewOpen(true)
        } catch (err) {
          setError(errorMessage(t, err))
        }
      }

      const asError = (result) => ({
        code: result.error,
        detail: typeof result.detail === 'string' ? result.detail : '',
      })

      const submit = async (alsoSave) => {
        setBusy(true)
        setError(null)
        try {
          if (alsoSave) {
            await request('/api/outlive/tasks', {
              method: 'POST',
              body:
                tab === 'command'
                  ? { kind: 'command', command, label, cwd }
                  : { kind: 'agent', task, label, cwd, agent },
            })
            notify(t('notice.saved'), 'ok')
            onChanged()
            return
          }
          if (tab === 'restart') {
            const result = await request('/api/outlive/run', { method: 'POST', body: { kind: 'restart', lang } })
            if (result.error) {
              setError(errorMessage(t, asError(result)))
            } else {
              notify(t('notice.started', { id: result.job.id }), 'ok')
              onChanged()
            }
            return
          }
          const body =
            tab === 'command'
              ? { kind: 'command', command, label, cwd, runtime_max_sec: runtime, lang }
              : { kind: 'agent', task, agent, label, cwd, runtime_max_sec: runtime, lang }
          const result = await request('/api/outlive/run', { method: 'POST', body })
          if (result.error) {
            setError(errorMessage(t, asError(result)))
          } else {
            notify(t('notice.started', { id: result.job.id }), 'ok')
            if (tab === 'agent') setTask('')
            else setCommand('')
            onChanged()
          }
        } catch (err) {
          setError(errorMessage(t, err))
        } finally {
          setBusy(false)
        }
      }

      const canRun = tab === 'restart' ? true : tab === 'command' ? command.trim().length > 0 : task.trim().length > 0
      const canSave = tab !== 'restart' && canRun

      return h(
        'section',
        { className: 'outlive-card', 'aria-label': t('compose.title') },
        h(
          'div',
          { className: 'outlive-card-head' },
          h('h2', { className: 'outlive-card-title' }, t('compose.title')),
          h(
            'div',
            { className: 'outlive-tabs', role: 'tablist' },
            ['agent', 'command', 'restart'].map((name) =>
              h(
                'button',
                {
                  key: name,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': tab === name,
                  className: 'outlive-tab',
                  onClick: () => {
                    setTab(name)
                    setPreviewOpen(false)
                    setError(null)
                  },
                },
                t(`compose.tab.${name}`),
              ),
            ),
          ),
        ),
        error ? h(Notice, { notice: { kind: 'error', text: error }, onClose: () => setError(null) }) : null,
        tab === 'restart'
          ? h(
              'div',
              { className: 'outlive-compose' },
              h('p', { className: 'outlive-hint' }, t('compose.restart.body')),
              h(
                'div',
                { className: 'outlive-plan' },
                h('div', { className: 'outlive-plan-line' }, h('b', null, t('compose.restart.plan')), h('span', null, plan ? (plan.mode === 'unit' ? t('compose.restart.unitMode', { unit: plan.unit }) : t('compose.restart.processMode')) : t('compose.restart.unknown'))),
                plan?.ports?.length ? h('div', { className: 'outlive-plan-line' }, h('b', null, ''), h('span', { className: 'outlive-hint' }, t('compose.restart.ports', { ports: plan.ports.join(', ') }))) : null,
              ),
              h(
                'div',
                { className: 'outlive-actions' },
                h('button', { type: 'button', className: 'outlive-btn primary', disabled: busy, onClick: () => submit(false) }, busy ? h('span', { className: 'outlive-spin' }) : h(Icon, { name: 'refresh', size: 13 }), t('compose.tab.restart')),
                h('button', { type: 'button', className: 'outlive-btn ghost', onClick: () => setPlanOpen((value) => !value) }, planOpen ? t('compose.preview.hide') : t('compose.preview')),
              ),
              planOpen
                ? h('div', null, h('div', { className: 'outlive-label', style: { marginBottom: 6 } }, t('job.command')), h('pre', { className: 'outlive-pre' }, plan?.command || t('compose.restart.unknown')))
                : null,
            )
          : h(
              'div',
              { className: 'outlive-compose' },
              h(
                'div',
                { className: 'outlive-row' },
                h(
                  'label',
                  { className: 'outlive-field' },
                  h('span', { className: 'outlive-label' }, t('compose.agent')),
                  tab === 'agent'
                    ? h(AgentSelect, { t, agents: agents.list, value: agent, onChange: setAgent })
                    : h('input', { className: 'outlive-input', value: t('jobs.kind.command'), readOnly: true, disabled: true }),
                ),
                h(
                  'label',
                  { className: 'outlive-field' },
                  h('span', { className: 'outlive-label' }, t('compose.label')),
                  h('input', { className: 'outlive-input', value: label, placeholder: t('compose.label.placeholder'), onChange: (event) => setLabel(event.target.value) }),
                ),
              ),
              h(
                'label',
                { className: 'outlive-field' },
                h('span', { className: 'outlive-label' }, tab === 'agent' ? t('compose.task') : t('compose.command')),
                tab === 'agent'
                  ? h('textarea', {
                      className: 'outlive-textarea',
                      value: task,
                      placeholder: t('compose.task.placeholder'),
                      onChange: (event) => setTask(event.target.value),
                      rows: 6,
                    })
                  : h('textarea', {
                      className: 'outlive-textarea mono',
                      value: command,
                      placeholder: t('compose.command.placeholder'),
                      onChange: (event) => setCommand(event.target.value),
                      rows: 6,
                    }),
              ),
              h(
                'div',
                { className: 'outlive-row' },
                h(
                  'label',
                  { className: 'outlive-field' },
                  h('span', { className: 'outlive-label' }, t('compose.cwd')),
                  h(
                    'div',
                    { className: 'outlive-row', style: { alignItems: 'center', gap: 6 } },
                    h('input', { className: 'outlive-input', value: cwd, placeholder: t('compose.cwd.placeholder'), onChange: (event) => setCwd(event.target.value) }),
                    h('button', { type: 'button', className: 'outlive-btn', onClick: () => setDialog(true) }, t('common.browse')),
                  ),
                ),
                h(
                  'label',
                  { className: 'outlive-field small' },
                  h('span', { className: 'outlive-label' }, t('compose.runtime')),
                  h('input', { className: 'outlive-input', type: 'number', min: 60, max: 604800, step: 60, value: runtime, onChange: (event) => setRuntime(Number(event.target.value) || 7200) }),
                ),
              ),
              previewOpen
                ? h('div', null, h('div', { className: 'outlive-label', style: { marginBottom: 6 } }, t('job.command')), h('pre', { className: 'outlive-pre' }, preview || ''))
                : null,
              h(
                'div',
                { className: 'outlive-actions' },
                h('button', { type: 'button', className: 'outlive-btn primary', disabled: busy || !canRun, onClick: () => submit(false) }, busy ? h('span', { className: 'outlive-spin' }) : h(Icon, { name: 'run', size: 12 }), t('compose.run')),
                h('button', { type: 'button', className: 'outlive-btn', disabled: busy || !canSave, onClick: () => submit(true) }, t('compose.save')),
                h('button', { type: 'button', className: 'outlive-btn ghost', onClick: showPreview }, previewOpen ? t('compose.preview.hide') : t('compose.preview')),
                h('span', { className: 'outlive-spacer' }),
                h('span', { className: 'outlive-hint' }, t('compose.hint')),
              ),
            ),
        dialog
          ? h(FileDialog, {
              t,
              mode: 'dir',
              initialPath: cwd || '',
              onClose: () => setDialog(false),
              onPick: (path) => {
                setCwd(path)
                setDialog(false)
              },
            })
          : null,
      )
    }

    function JobsCard({ t, jobs, logs, onLoadLog, onCancel, onDelete, onClear, busy }) {
      const [filter, setFilter] = useState('all')
      const [openId, setOpenId] = useState(null)
      const [confirmClear, setConfirmClear] = useState(false)
      const visible = jobs.filter((job) => (filter === 'all' ? true : filter === 'running' ? job.status === 'running' : job.status !== 'running'))

      useEffect(() => {
        if (!openId) return
        const job = jobs.find((entry) => entry.id === openId)
        if (!job) return
        onLoadLog(job)
        if (job.status !== 'running') return
        const timer = setInterval(() => onLoadLog(job), LOG_POLL_MS)
        return () => clearInterval(timer)
      }, [openId, jobs, onLoadLog])

      return h(
        'section',
        { className: 'outlive-card', 'aria-label': t('jobs.title') },
        h(
          'div',
          { className: 'outlive-card-head' },
          h('h2', { className: 'outlive-card-title' }, t('jobs.title')),
          h(
            'div',
            { className: 'outlive-actions' },
            ['all', 'running', 'settled'].map((name) =>
              h('button', { key: name, type: 'button', className: `outlive-btn small${filter === name ? ' primary' : ' ghost'}`, onClick: () => setFilter(name) }, t(`jobs.filter.${name}`)),
            ),
            confirmClear
              ? h(
                  Fragment,
                  null,
                  h('button', { type: 'button', className: 'outlive-btn small danger', disabled: busy, onClick: () => { setConfirmClear(false); onClear() } }, t('jobs.clear')),
                  h('button', { type: 'button', className: 'outlive-btn small', onClick: () => setConfirmClear(false) }, t('common.cancel')),
                )
              : h('button', { type: 'button', className: 'outlive-btn small ghost', disabled: !jobs.some((job) => job.status !== 'running'), onClick: () => setConfirmClear(true) }, t('jobs.clear')),
          ),
        ),
        !jobs.length
          ? h('div', { className: 'outlive-emptystate' }, t('jobs.empty'))
          : !visible.length
            ? h('div', { className: 'outlive-emptystate' }, t('jobs.emptyFiltered'))
            : h(
                'div',
                { className: 'outlive-jobs' },
                visible.map((job) =>
                  h(
                    'div',
                    { key: job.id, className: `outlive-job${openId === job.id ? ' open' : ''}` },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'outlive-job-row',
                        'aria-expanded': openId === job.id,
                        onClick: () => {
                          if (openId === job.id) {
                            setOpenId(null)
                          } else {
                            setOpenId(job.id)
                            onLoadLog(job)
                          }
                        },
                      },
                      h(StatusPill, { status: job.status, t }),
                      h(
                        'span',
                        { style: { minWidth: 0 } },
                        h('div', { className: 'outlive-job-label' }, job.label || (job.kind === 'restart' ? t('compose.restart.title') : job.command || job.id)),
                        h('div', { className: 'outlive-job-meta' }, `${t(`jobs.kind.${job.kind}`)} · ${formatAgo(job.startedAt, t)}`),
                      ),
                      h('span', { className: 'outlive-job-agent col-agent' }, job.agent || (job.kind === 'restart' ? job.mode || '—' : t('jobs.kind.command'))),
                      h('span', { className: 'outlive-job-time col-time' }, formatDuration(job.startedAt, job.finishedAt)),
                      h('span', { className: 'outlive-chevron', 'aria-hidden': 'true' }, openId === job.id ? '▾' : '▸'),
                    ),
                    openId === job.id
                      ? h(JobDetail, {
                          t,
                          job,
                          log: logs[job.id] === undefined ? null : logs[job.id],
                          onCancel,
                          onDelete,
                          busy,
                        })
                      : null,
                  ),
                ),
              ),
      )
    }

    function MainPage({ t, lang, data, logs, busy, notice, onDismissNotice, onRefresh, onRunJob, onCancel, onDelete, onClear, onLoadLog, onRunSaved, onDeleteSaved, onRestoreBuiltin, notify }) {
      const [settings, setSettings] = useState(false)
      const jobs = data?.jobs || []
      const tasks = (data?.tasks || []).filter((task) => !task.builtin)
      const removedBuiltin = (data?.builtins?.removed || []).includes('restart-dsh')
      const running = jobs.filter((job) => job.status === 'running').length
      const [restartPlan, setRestartPlan] = useState(null)

      useEffect(() => {
        let alive = true
        request('/api/outlive/preview', { method: 'POST', body: { kind: 'restart' } })
          .then((result) => {
            if (alive) setRestartPlan(result)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      return h(
        'div',
        { className: 'outlive-page' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'outlive-header' },
          h(
            'div',
            null,
            h('h1', { className: 'outlive-title' }, t('panel.title')),
            h('p', { className: 'outlive-subtitle' }, t('panel.subtitle')),
          ),
          h(
            'div',
            { className: 'outlive-header-actions' },
            running ? h('span', { className: 'outlive-running' }, t('panel.running', { count: running })) : null,
            h('button', { type: 'button', className: 'outlive-icon-btn', onClick: onRefresh, 'aria-label': t('panel.refresh'), title: t('panel.refresh') }, h(Icon, { name: 'refresh' })),
            h('button', { type: 'button', className: 'outlive-btn', onClick: () => setSettings(true) }, h(Icon, { name: 'settings', size: 13 }), t('panel.settings')),
          ),
        ),
        notice ? h(Notice, { notice, onClose: onDismissNotice }) : null,
        h(
          'div',
          { className: 'outlive-grid' },
          h(
            'div',
            { className: 'outlive-main' },
            h(Composer, { t, lang, agents: data?.agents || { list: [], default: null }, onChanged: onRefresh, notify }),
            h(JobsCard, { t, jobs, logs, onLoadLog, onCancel, onDelete, onClear: onClear, busy }),
          ),
          h(
            'aside',
            { className: 'outlive-side' },
            h(
              'section',
              { className: 'outlive-card' },
              h(
                'div',
                { className: 'outlive-card-head' },
                h('h2', { className: 'outlive-card-title' }, t('compose.restart.title')),
                h('span', { className: 'outlive-badge accent' }, t('tasks.builtin')),
              ),
              h('p', { className: 'outlive-card-note' }, t('compose.restart.body')),
              restartPlan
                ? h(
                    'div',
                    { className: 'outlive-plan', style: { marginTop: 10 } },
                    h('div', { className: 'outlive-plan-line' }, h('b', null, t('compose.restart.plan')), h('span', null, restartPlan.mode === 'unit' ? t('compose.restart.unitMode', { unit: restartPlan.unit }) : t('compose.restart.processMode'))),
                    restartPlan.ports?.length ? h('div', { className: 'outlive-plan-line' }, h('b', null, ''), h('span', { className: 'outlive-hint' }, t('compose.restart.ports', { ports: restartPlan.ports.join(', ') }))) : null,
                  )
                : null,
              removedBuiltin
                ? h(
                    'div',
                    { className: 'outlive-actions', style: { marginTop: 12 } },
                    h('span', { className: 'outlive-hint' }, t('tasks.removed')),
                    h('button', { type: 'button', className: 'outlive-btn', onClick: onRestoreBuiltin }, t('tasks.restore')),
                  )
                : h(
                    'div',
                    { className: 'outlive-actions', style: { marginTop: 12 } },
                    h('button', { type: 'button', className: 'outlive-btn primary', disabled: busy, onClick: () => onRunJob({ kind: 'restart' }) }, h(Icon, { name: 'refresh', size: 13 }), t('tasks.run')),
                  ),
            ),
            h(
              'section',
              { className: 'outlive-card' },
              h('div', { className: 'outlive-card-head' }, h('h2', { className: 'outlive-card-title' }, t('tasks.title'))),
              !tasks.length
                ? h('div', { className: 'outlive-emptystate' }, t('tasks.empty'))
                : tasks.map((task) =>
                    h(
                      'div',
                      { key: task.id, className: 'outlive-task' },
                      h(
                        'div',
                        { className: 'outlive-task-main' },
                        h('div', { className: 'outlive-task-label', title: task.label || '' }, task.label || task.id),
                        h('div', { className: 'outlive-task-meta' }, [task.kind, task.agent, task.cwd].filter(Boolean).join(' · ')),
                      ),
                      h('button', { type: 'button', className: 'outlive-icon-btn', disabled: busy, onClick: () => onRunSaved(task), 'aria-label': t('tasks.run'), title: t('tasks.run') }, h(Icon, { name: 'run', size: 11 })),
                      h('button', { type: 'button', className: 'outlive-icon-btn', disabled: busy, onClick: () => onDeleteSaved(task), 'aria-label': t('tasks.delete'), title: t('tasks.delete') }, h(Icon, { name: 'trash', size: 12 })),
                    ),
                  ),
            ),
            h(
              'section',
              { className: 'outlive-card' },
              h(
                'div',
                { className: 'outlive-card-head' },
                h('h2', { className: 'outlive-card-title' }, t('agents.title')),
                h('button', { type: 'button', className: 'outlive-btn small ghost', onClick: () => setSettings(true) }, t('agents.manage')),
              ),
              h('p', { className: 'outlive-card-note' }, data?.agents?.default ? t('agents.default', { name: data.agents.default }) : t('agents.none')),
              h(
                'div',
                { style: { marginTop: 8 } },
                (data?.agents?.list || []).filter((agent) => agent.installed).slice(0, 4).map((agent) =>
                  h(
                    'div',
                    { key: agent.name, className: 'outlive-task' },
                    h('div', { className: 'outlive-task-main' }, h('div', { className: 'outlive-task-label' }, agent.label || agent.name), h('div', { className: 'outlive-task-meta' }, agent.version || agent.bin || '')),
                    h('span', { className: `outlive-badge${agent.ready ? ' accent' : ' warn'}` }, agent.ready ? t('agents.ready') : t('agents.needsArguments')),
                  ),
                ),
              ),
            ),
          ),
        ),
        settings
          ? h(SettingsDrawer, {
              t,
              data,
              onClose: () => setSettings(false),
              onChanged: onRefresh,
              notify,
            })
          : null,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'outlive: dictionaries')
      const t = ctx.locale.bind(NS)

      let state = null
      let listeners = new Set()

      const publish = () => {
        for (const listener of listeners) listener(state)
      }

      const load = async () => {
        state = { ...(state || {}), loading: true }
        try {
          const data = await request('/api/outlive/state')
          state = { data, error: null, loading: false, updatedAt: Date.now() }
        } catch (error) {
          state = { ...(state || {}), error, loading: false }
        }
        publish()
        return state
      }

      const runAction = async (body, successKey, notify, extra) => {
        try {
          const result = await request('/api/outlive/run', { method: 'POST', body })
          if (result.error) {
            notify(errorMessage(t, { code: result.error, detail: typeof result.detail === 'string' ? result.detail : '' }), 'error')
            return null
          }
          notify(t(successKey, { id: result.job.id }), 'ok')
          if (extra) extra(result)
          await load()
          return result
        } catch (error) {
          notify(errorMessage(t, error), 'error')
          return null
        }
      }

      function OutlivePage(props) {
        const translate = props.t || t
        const lang = (() => {
          try {
            return ctx.locale.getSnapshot().active === 'zh' ? 'zh' : 'en'
          } catch {
            return 'en'
          }
        })()
        const [snapshot, setSnapshot] = useState(state)
        const [busy, setBusy] = useState(false)
        const [logs, setLogs] = useState({})
        const [notice, setNotice] = useState(null)
        const noticeTimer = useRef(null)

        useEffect(() => {
          listeners.add(setSnapshot)
          load()
          const timer = setInterval(() => {
            if (!document.hidden) load()
          }, POLL_MS)
          return () => {
            listeners.delete(setSnapshot)
            clearInterval(timer)
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        const notify = useCallback(
          (message, kind = 'ok') => {
            setNotice({ text: message, kind })
            if (noticeTimer.current) clearTimeout(noticeTimer.current)
            noticeTimer.current = setTimeout(() => setNotice(null), 6000)
          },
          [],
        )

        useEffect(() => () => {
          if (noticeTimer.current) clearTimeout(noticeTimer.current)
        }, [])

        const loadLog = useCallback(async (job) => {
          try {
            const result = await request(`/api/outlive/log?id=${encodeURIComponent(job.id)}&tail=300`)
            setLogs((current) => ({ ...current, [job.id]: result.log || '' }))
          } catch {
            setLogs((current) => ({ ...current, [job.id]: '' }))
          }
        }, [])

        const cancelJob = async (job) => {
          setBusy(true)
          try {
            await request('/api/outlive/cancel', { method: 'POST', body: { id: job.id } })
            notify(translate('notice.cancelled'), 'ok')
            await load()
          } catch (error) {
            notify(errorMessage(translate, error), 'error')
          } finally {
            setBusy(false)
          }
        }

        const deleteJob = async (job) => {
          setBusy(true)
          try {
            await request('/api/outlive/delete', { method: 'POST', body: { id: job.id } })
            setLogs((current) => {
              const next = { ...current }
              delete next[job.id]
              return next
            })
            notify(translate('notice.deleted'), 'ok')
            await load()
          } catch (error) {
            notify(errorMessage(translate, error), 'error')
          } finally {
            setBusy(false)
          }
        }

        const clearJobs = async () => {
          setBusy(true)
          try {
            await request('/api/outlive/jobs/clear', { method: 'POST', body: {} })
            notify(translate('notice.cleared'), 'ok')
            await load()
          } catch (error) {
            notify(errorMessage(translate, error), 'error')
          } finally {
            setBusy(false)
          }
        }

        const runSaved = async (task) => {
          setBusy(true)
          try {
            await runAction(
              task.kind === 'command'
                ? { kind: 'command', command: task.command, label: task.label, cwd: task.cwd || undefined, taskId: task.id, lang }
                : { kind: 'agent', task: task.task, agent: task.agent || 'auto', label: task.label, cwd: task.cwd || undefined, taskId: task.id, lang },
              'notice.started',
              notify,
            )
          } finally {
            setBusy(false)
          }
        }

        const deleteSaved = async (task) => {
          setBusy(true)
          try {
            await request('/api/outlive/tasks/delete', { method: 'POST', body: { id: task.id } })
            notify(translate('notice.taskDeleted'), 'ok')
            await load()
          } catch (error) {
            notify(errorMessage(translate, error), 'error')
          } finally {
            setBusy(false)
          }
        }

        const restoreBuiltin = async () => {
          setBusy(true)
          try {
            await request('/api/outlive/tasks/restore', { method: 'POST', body: { key: 'restart-dsh' } })
            notify(translate('notice.restored'), 'ok')
            await load()
          } catch (error) {
            notify(errorMessage(translate, error), 'error')
          } finally {
            setBusy(false)
          }
        }

        if (!snapshot?.data) {
          return h(
            'div',
            { className: 'outlive-page' },
            h('style', null, CSS),
            h('h1', { className: 'outlive-title' }, translate('panel.title')),
            snapshot?.error
              ? h(Notice, { notice: { kind: 'error', text: errorMessage(translate, snapshot.error) }, onClose: () => load() })
              : h('p', { className: 'outlive-hint', style: { marginTop: 16 } }, h('span', { className: 'outlive-spin' })),
          )
        }

        return h(MainPage, {
            t: translate,
            lang,
            data: snapshot.data,
            logs,
            busy,
            notice,
            onDismissNotice: () => setNotice(null),
            onRefresh: load,
            onRunJob: async (body) => {
              setBusy(true)
              try {
                await runAction({ ...body, lang }, 'notice.started', notify)
              } finally {
                setBusy(false)
              }
            },
            onCancel: cancelJob,
            onDelete: deleteJob,
            onClear: clearJobs,
            onLoadLog: loadLog,
            onRunSaved: runSaved,
            onDeleteSaved: deleteSaved,
            onRestoreBuiltin: restoreBuiltin,
            notify,
        })
      }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ ctx }),
          },
          OutlivePage,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 24,
            locale: NS,
            label: () => t('panel.title'),
          },
          OutliveIcon,
        ),
      )

      const input = () => {
        const source = {
          trigger: '/',
          name: 'outlive',
          order: 30,
          candidates(_session, query) {
            const term = String(query || '').trim().toLowerCase()
            const fixed = [{ id: 'outlive:agent', name: 'outlive', description: t('trigger.agent.desc'), role: 'agent' }]
            const saved = (state?.data?.tasks || [])
              .filter((task) => !task.builtin)
              .map((task) => ({
                id: `outlive:${task.id}`,
                name: `outlive · ${task.label || task.id}`,
                description: [task.kind, task.agent].filter(Boolean).join(' · '),
                task,
              }))
            return [...fixed, ...saved].filter((entry) => !term || `${entry.name} ${entry.description}`.toLowerCase().includes(term))
          },
          onPick(entry) {
            if (entry.task) {
              const draft = entry.task.kind === 'command' ? t('trigger.draft.command') : t('trigger.draft')
              return `${draft}\n\n${entry.task.kind === 'command' ? entry.task.command : entry.task.task}`
            }
            return `${t('trigger.draft')}\n\n`
          },
        }
        const existing = ctx.get?.('inputTriggers')
        if (existing?.registerSource) ctx.effect(() => existing.registerSource(source), 'outlive: slash source')
        else ctx.inject(['inputTriggers'], (triggers) => triggers.registerSource(source))
      }

      input()
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
