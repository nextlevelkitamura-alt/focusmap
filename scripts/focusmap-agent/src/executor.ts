/**
 * Focusmap Lite task executor.
 *
 * Service role key はMacへ置かず、すべて Focusmap API 経由で状態更新する。
 */

import type { AgentApiClient } from './api-client.js';
import type { AgentCommand, AgentConfig, AiTask, TaskResultJson } from './types.js';
import { runWebResearch } from './skills/web-research.js';
import { executeCommand } from './command-executor.js';
import { error as logError, info } from './logger.js';

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>）)]+/g);
  return matches ? [...new Set(matches)] : [];
}

function commandFromTask(task: AiTask): string | null {
  const args = (task.package_snapshot as { args?: Record<string, unknown> } | null)?.args ?? {};
  if (typeof args.command === 'string' && args.command.trim()) return args.command.trim();
  if (typeof args.shell === 'string' && args.shell.trim()) return args.shell.trim();
  return task.prompt.trim() || null;
}

function makeCommand(task: AiTask, type: AgentCommand['type'], payload: Record<string, unknown>): AgentCommand {
  return {
    id: `task:${task.id}`,
    runner_id: '',
    user_id: task.user_id,
    space_id: task.space_id,
    task_id: task.id,
    type,
    payload,
    status: 'running',
  };
}

async function runBrowserOpen(task: AiTask, config: AgentConfig): Promise<TaskResultJson> {
  const args = (task.package_snapshot as { args?: Record<string, unknown> } | null)?.args ?? {};
  const url = typeof args.url === 'string' && args.url.trim()
    ? args.url.trim()
    : extractUrls(task.prompt)[0] ?? 'https://focusmap-official.com/dashboard/settings/automation';
  const result = await executeCommand(makeCommand(task, 'open_url', { url }), config);
  return {
    executor: 'browser',
    steps: [
      { label: 'ブラウザ起動', status: 'done', at: new Date().toISOString(), detail: url },
    ],
    output: JSON.stringify(result, null, 2),
    meta: { url },
  };
}

async function runTerminal(task: AiTask, config: AgentConfig): Promise<TaskResultJson> {
  const command = commandFromTask(task);
  if (!command) throw new Error('terminal command is empty');
  const result = await executeCommand(makeCommand(task, 'run_shell', { command }), config);
  return {
    executor: 'terminal',
    steps: [
      { label: 'ターミナル実行', status: 'done', at: new Date().toISOString(), detail: command },
    ],
    output: JSON.stringify(result, null, 2),
    meta: { command },
  };
}

async function runUrlFetch(task: AiTask, config: AgentConfig): Promise<TaskResultJson> {
  const urls = extractUrls(task.prompt);
  if (urls.length === 0) {
    throw new Error('URLが見つかりません。https:// から始まるURLを指定してください。');
  }
  return runWebResearch({
    ...task,
    skill_id: 'web-research',
    package_snapshot: {
      ...(task.package_snapshot ?? {}),
      args: { urls, keywords: [] },
    },
  }, config);
}

async function runTask(task: AiTask, config: AgentConfig): Promise<TaskResultJson> {
  if (task.executor === 'terminal' || task.skill_id === 'terminal-command') {
    return runTerminal(task, config);
  }
  if (task.executor === 'browser' || task.skill_id === 'browser-open') {
    return runBrowserOpen(task, config);
  }
  if (task.skill_id === 'web-research') {
    return runWebResearch(task, config);
  }
  if (task.executor === 'playwright' && extractUrls(task.prompt).length > 0) {
    return runUrlFetch(task, config);
  }
  if (task.skill_id === 'calendar-organize' || task.skill_id === 'email-summary') {
    throw new Error('このスキルはFocusmap Lite側のGWS / Google Workspace MCP認証へ移行中です。設定画面からGWS認証を完了してください。');
  }
  throw new Error(`Unsupported task: executor=${task.executor}, skill_id=${task.skill_id ?? '<null>'}`);
}

export async function executeTask(
  task: AiTask,
  api: AgentApiClient,
  config: AgentConfig,
  runnerId: string,
): Promise<void> {
  await api.updateTaskState(runnerId, task.id, 'running', {
    result: {
      executor: task.executor === 'terminal' ? 'terminal' : task.executor === 'browser' ? 'browser' : 'playwright',
      steps: [{ label: 'Focusmap Lite が受信', status: 'done', at: new Date().toISOString() }],
      output: '',
      meta: { prompt: task.prompt, skill_id: task.skill_id, executor: task.executor },
    },
  });

  try {
    const result = await runTask(task, config);
    await api.updateTaskState(runnerId, task.id, 'completed', { result });
    info(`task ${task.id} completed (${task.skill_id ?? task.executor})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`task ${task.id} failed:`, message);
    await api.updateTaskState(runnerId, task.id, 'failed', {
      error: message,
      result: {
        executor: task.executor === 'terminal' ? 'terminal' : task.executor === 'browser' ? 'browser' : 'playwright',
        steps: [{ label: '実行失敗', status: 'failed', at: new Date().toISOString(), detail: message }],
        output: '',
        error: message,
      },
    });
  }
}
