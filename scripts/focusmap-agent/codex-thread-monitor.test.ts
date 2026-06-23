import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activityMessages,
  aiHistoryHotSyncPreparedItemLimit,
  aiHistoryDetailMessages,
  aiHistoryPresentationForThread,
  aiHistoryTitle,
  AI_HISTORY_FAST_WATCH_LIMIT,
  AI_HISTORY_PLACEHOLDER_TITLE,
  AWAITING_APPROVAL_STABILITY_MS,
  awaitingApprovalAtForSummary,
  codexStateDbPath,
  codexSessionThreadNamesFromJsonl,
  codexThreadGeneratedTitle,
  DEFAULT_RECONCILE_INTERVAL_MS,
  DEFAULT_TARGET_REFRESH_INTERVAL_MS,
  hasPendingArchiveRequest,
  isFocusmapManualHandoffThread,
  isAiHistoryPlaceholderTitle,
  isCodexThreadPromptDerivedTitle,
  isOrphanImportApiUnavailable,
  isOrphanThreadImportCandidate,
  knownCodexThreadIds,
  markAiHistoryPlaceholderTitleWatch,
  markAiHistoryRolloutInspected,
  markTaskRolloutInspected,
  markThreadGone,
  mergeRecentThreadsForHotSync,
  matchingThreadImportScope,
  orphanImportLimitForPreImportTasks,
  parseRollout,
  preImportCodexMonitorTasks,
  prioritizeCodexMonitorTasks,
  RESUME_RUNNING_VISIBILITY_MS,
  TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS,
  shouldInspectAiHistoryRollout,
  shouldInspectAiHistoryPlaceholderTitle,
  shouldInspectTaskRollout,
  shouldArchiveAiHistoryThread,
  shouldCompleteSourceFromArchivedThread,
  shouldDeferOrphanImportForTasks,
  taskStateForSummary,
} from './src/codex-thread-monitor';
import { AgentApiError } from './src/api-client';

const threadRow = {
  id: 'thread-1',
  title: 'やてひねす',
  archived: 0,
  updated_at_ms: Date.parse('2026-06-08T15:49:18.370Z'),
  preview: null,
  rollout_path: '/tmp/rollout.jsonl',
  source: 'codex_app',
  cwd: null,
  first_user_message: 'やてひねす',
};

function line(timestamp: string, payload: Record<string, unknown>) {
  return JSON.stringify({ timestamp, payload });
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    user_id: 'user-1',
    space_id: null,
    prompt: 'やてひねす',
    skill_id: null,
    approval_type: 'auto',
    status: 'running',
    executor: 'codex_app',
    result: {
      codex_run_state: 'running',
      last_activity_at: '2026-06-08T15:49:18.000Z',
    },
    created_at: '2026-06-08T15:47:57.527Z',
    started_at: '2026-06-08T15:49:19.771Z',
    completed_at: null,
    ...overrides,
  } as never;
}

describe('codex-thread-monitor state detection', () => {
  test('refreshes monitor targets within three seconds by default', () => {
    expect(DEFAULT_TARGET_REFRESH_INTERVAL_MS).toBe(3_000);
  });

  test('reconciles enabled Codex history repos hourly by default', () => {
    expect(DEFAULT_RECONCILE_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  test('keeps Codex completion debounce below the visible UI lag target', () => {
    expect(AWAITING_APPROVAL_STABILITY_MS).toBe(1_000);
    expect(RESUME_RUNNING_VISIBILITY_MS).toBe(2_000);
    expect(TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS).toBe(30 * 60 * 1000);
  });

  test('keeps hot sync capacity for the latest 20 threads per project scope plus global head', () => {
    expect(AI_HISTORY_FAST_WATCH_LIMIT).toBe(20);
    expect(aiHistoryHotSyncPreparedItemLimit({
      maxItems: AI_HISTORY_FAST_WATCH_LIMIT,
      importScopeCount: 3,
      includeAllCodexCwds: true,
    })).toBe(80);
    expect(aiHistoryHotSyncPreparedItemLimit({
      maxItems: AI_HISTORY_FAST_WATCH_LIMIT,
      importScopeCount: 3,
      includeAllCodexCwds: false,
    })).toBe(60);
  });

  test('merges global and per-scope recent threads without losing scope-only rows', () => {
    const now = Date.parse('2026-06-10T00:00:00.000Z');
    const globalRow = { ...threadRow, id: 'thread-global', updated_at_ms: now + 30_000 };
    const sharedRow = { ...threadRow, id: 'thread-shared', updated_at_ms: now + 20_000 };
    const scopeOnlyRow = { ...threadRow, id: 'thread-scope-only', updated_at_ms: now + 10_000 };

    expect(mergeRecentThreadsForHotSync(
      [globalRow, sharedRow],
      [sharedRow, scopeOnlyRow],
    ).map(row => row.id)).toEqual([
      'thread-global',
      'thread-shared',
      'thread-scope-only',
    ]);
  });

  test('uses a visible prompt title until Codex generates a sidebar title', () => {
    expect(aiHistoryTitle({
      ...threadRow,
      id: 'thread-placeholder-title',
      title: null,
      first_user_message: null,
      preview: null,
    })).toBe(AI_HISTORY_PLACEHOLDER_TITLE);
    expect(aiHistoryTitle({
      ...threadRow,
      id: 'thread-prompt-derived-title',
      title: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
      first_user_message: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
      preview: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
    })).toBe('結構幅が広いから');
    expect(aiHistoryTitle({
      ...threadRow,
      id: 'thread-wrapped-prompt-title',
      title: '# AGENTS.md instructions\n<environment_context>\n## My request for Codex:\nAI履歴の検知を2秒以内に戻してほしい\n<skill>hidden</skill>',
      first_user_message: '# AGENTS.md instructions\n<environment_context>\n## My request for Codex:\nAI履歴の検知を2秒以内に戻してほしい\n<skill>hidden</skill>',
      preview: null,
    })).toBe('AI履歴の検知を2秒以内に戻してほしい');
    expect(isAiHistoryPlaceholderTitle(AI_HISTORY_PLACEHOLDER_TITLE)).toBe(true);
    expect(isAiHistoryPlaceholderTitle('Codex thread abc12345')).toBe(true);
    expect(isAiHistoryPlaceholderTitle('AI履歴のUIを見やすくする')).toBe(false);
  });

  test('prefers Codex session_index thread_name over prompt-derived SQLite titles', () => {
    const row = {
      ...threadRow,
      id: 'thread-session-index-title',
      title: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
      first_user_message: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
      preview: '結構幅が広いから\nこの辺どうにかしてほしい\nマインドマップの幅が広いんだよね',
    };
    const threadNames = codexSessionThreadNamesFromJsonl([
      JSON.stringify({
        id: row.id,
        thread_name: '古い見出し',
        updated_at: '2026-06-21T00:00:00.000Z',
      }),
      JSON.stringify({
        id: row.id,
        thread_name: 'マインドマップ幅を調整',
        updated_at: '2026-06-22T01:52:33.175Z',
      }),
    ].join('\n'));

    expect(isCodexThreadPromptDerivedTitle(row)).toBe(true);
    expect(codexThreadGeneratedTitle(row)).toBeNull();
    expect(aiHistoryTitle(row, threadNames)).toBe('マインドマップ幅を調整');
  });

  test('keeps placeholder-title AI history threads on a short title refresh watch', () => {
    const scope = { project_id: 'project-placeholder-title', repo_path: '/repo-placeholder-title' };
    const row = {
      ...threadRow,
      id: 'thread-placeholder-title-watch',
      cwd: '/repo-placeholder-title',
      title: null,
      preview: null,
    };
    const now = Date.parse('2026-06-10T00:00:00.000Z');

    expect(shouldInspectAiHistoryPlaceholderTitle(row, scope, now)).toBe(false);
    markAiHistoryPlaceholderTitleWatch(row, scope, now);
    expect(shouldInspectAiHistoryPlaceholderTitle(row, scope, now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryPlaceholderTitle(row, scope, now + 6 * 60_000)).toBe(false);
  });

  test('fast-watches AI history rollouts every second', () => {
    const scope = { project_id: 'project-rollout-cache', repo_path: '/repo-rollout-cache' };
    const row = {
      ...threadRow,
      id: 'thread-rollout-cache-stable',
      cwd: '/repo-rollout-cache',
    };
    const now = Date.parse('2026-06-10T00:00:00.000Z');

    expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now)).toBe(true);

    markAiHistoryRolloutInspected(row, scope, false, now);

    expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryRollout(row, scope, 'reconcile', now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryRollout({
      ...row,
      updated_at_ms: row.updated_at_ms + 1,
    }, scope, 'hot', now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 60_000)).toBe(true);
  });

  test('inspects fast-watch rollouts again after one second', () => {
    const dir = mkdtempSync(join(tmpdir(), 'focusmap-rollout-watch-'));
    try {
      const rolloutPath = join(dir, 'rollout.jsonl');
      writeFileSync(rolloutPath, line('2026-06-10T00:00:00.000Z', { type: 'task_started' }));
      const scope = { project_id: 'project-running-cache', repo_path: '/repo-running-cache' };
      const now = Date.parse('2026-06-10T00:00:00.000Z');
      const row = {
        ...threadRow,
        id: 'thread-rollout-cache-running-stat',
        cwd: '/repo-running-cache',
        rollout_path: rolloutPath,
        updated_at_ms: now,
      };
      const runningTask = task({
        id: 'task-rollout-cache-running-stat',
        codex_thread_id: row.id,
      });

      markAiHistoryRolloutInspected(row, scope, true, now);
      markTaskRolloutInspected(runningTask, row, row.id, true, now);

      expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 1_000)).toBe(true);
      expect(shouldInspectTaskRollout(runningTask, row, row.id, now + 1_000)).toBe(true);

      writeFileSync(rolloutPath, [
        line('2026-06-10T00:00:00.000Z', { type: 'task_started' }),
        line('2026-06-10T00:00:01.000Z', { type: 'user_message', message: '追加で確認して' }),
      ].join('\n'));
      const changedDate = new Date(now + 2_000);
      utimesSync(rolloutPath, changedDate, changedDate);

      expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 2_000)).toBe(true);
      expect(shouldInspectTaskRollout(runningTask, row, row.id, now + 2_000)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps running AI history and task rollouts on a one-second deep watch', () => {
    const scope = { project_id: 'project-running-cache', repo_path: '/repo-running-cache' };
    const now = Date.parse('2026-06-10T00:00:00.000Z');
    const row = {
      ...threadRow,
      id: 'thread-rollout-cache-running-missing',
      cwd: '/repo-running-cache',
      updated_at_ms: now,
    };
    const runningTask = task({
      id: 'task-rollout-cache-running-missing',
      codex_thread_id: row.id,
    });

    markAiHistoryRolloutInspected(row, scope, true, now);
    markTaskRolloutInspected(runningTask, row, row.id, true, now);

    expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 500)).toBe(false);
    expect(shouldInspectTaskRollout(runningTask, row, row.id, now + 500)).toBe(false);
    expect(shouldInspectAiHistoryRollout(row, scope, 'hot', now + 1_000)).toBe(true);
    expect(shouldInspectTaskRollout(runningTask, row, row.id, now + 1_000)).toBe(true);
  });

  test('keeps stale running rollout fallback on one-second deep watch', () => {
    const now = Date.parse('2026-06-10T00:00:00.000Z');
    const scope = { project_id: 'project-stale-running-cache', repo_path: '/repo-stale-running-cache' };
    const staleRow = {
      ...threadRow,
      id: 'thread-rollout-cache-stale-running',
      cwd: '/repo-stale-running-cache',
      updated_at_ms: now - 5 * 60_000,
    };
    const staleTask = task({
      id: 'task-rollout-cache-stale-running',
      codex_thread_id: staleRow.id,
      result: {
        codex_run_state: 'running',
        last_activity_at: new Date(now - 5 * 60_000).toISOString(),
      },
    });

    markAiHistoryRolloutInspected(staleRow, scope, true, now);
    markTaskRolloutInspected(staleTask, staleRow, staleRow.id, true, now);

    expect(shouldInspectAiHistoryRollout(staleRow, scope, 'hot', now + 1_000)).toBe(true);
    expect(shouldInspectTaskRollout(staleTask, staleRow, staleRow.id, now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryRollout({
      ...staleRow,
      updated_at_ms: now + 1,
    }, scope, 'hot', now + 1_000)).toBe(true);
    expect(shouldInspectTaskRollout(staleTask, {
      ...staleRow,
      updated_at_ms: now + 1,
    }, staleRow.id, now + 1_000)).toBe(true);
    expect(shouldInspectAiHistoryRollout(staleRow, scope, 'hot', now + 30_000)).toBe(true);
    expect(shouldInspectTaskRollout(staleTask, staleRow, staleRow.id, now + 30_000)).toBe(true);
  });

  test('prefers the freshest default Codex state DB path', () => {
    const originalConfiguredPath = process.env.FOCUSMAP_CODEX_STATE_DB_PATH;
    delete process.env.FOCUSMAP_CODEX_STATE_DB_PATH;
    const home = mkdtempSync(join(tmpdir(), 'focusmap-codex-state-'));
    try {
      const legacyDir = join(home, '.codex');
      const sqliteDir = join(legacyDir, 'sqlite');
      mkdirSync(sqliteDir, { recursive: true });
      const legacyPath = join(legacyDir, 'state_5.sqlite');
      const sqlitePath = join(sqliteDir, 'state_5.sqlite');
      writeFileSync(legacyPath, '');
      writeFileSync(sqlitePath, '');
      const oldDate = new Date('2026-06-01T00:00:00.000Z');
      const newDate = new Date('2026-06-02T00:00:00.000Z');
      utimesSync(sqlitePath, oldDate, oldDate);
      utimesSync(legacyPath, newDate, newDate);

      expect(codexStateDbPath(home)).toBe(legacyPath);
    } finally {
      if (originalConfiguredPath === undefined) delete process.env.FOCUSMAP_CODEX_STATE_DB_PATH;
      else process.env.FOCUSMAP_CODEX_STATE_DB_PATH = originalConfiguredPath;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('uses FOCUSMAP_CODEX_STATE_DB_PATH before default Codex state paths', () => {
    const originalConfiguredPath = process.env.FOCUSMAP_CODEX_STATE_DB_PATH;
    const home = mkdtempSync(join(tmpdir(), 'focusmap-codex-state-'));
    try {
      const legacyDir = join(home, '.codex');
      const sqliteDir = join(legacyDir, 'sqlite');
      mkdirSync(sqliteDir, { recursive: true });
      const configuredPath = join(home, 'custom-state.sqlite');
      const sqlitePath = join(sqliteDir, 'state_5.sqlite');
      writeFileSync(configuredPath, '');
      writeFileSync(sqlitePath, '');
      process.env.FOCUSMAP_CODEX_STATE_DB_PATH = configuredPath;

      expect(codexStateDbPath(home)).toBe(configuredPath);
    } finally {
      if (originalConfiguredPath === undefined) delete process.env.FOCUSMAP_CODEX_STATE_DB_PATH;
      else process.env.FOCUSMAP_CODEX_STATE_DB_PATH = originalConfiguredPath;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('normalizes Codex sidebar titles and keeps the first visible line', () => {
    expect(codexThreadGeneratedTitle({ title: '  Codex   thread title  ' })).toBe('Codex thread title');
    expect(codexThreadGeneratedTitle({ title: '# AGENTS.md instructions\n<environment_context>' })).toBeNull();
    expect(codexThreadGeneratedTitle({ title: 'AI要約が見づらいんだけど\nどうするのがいいのかな' })).toBe('AI要約が見づらいんだけど');
    expect(codexThreadGeneratedTitle({
      title: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう',
      first_user_message: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももうちょっと整えてほしい。詳細も続きます。',
    })).toBeNull();
  });

  test('only treats completed tasks with pending archive request as archive candidates', () => {
    expect(hasPendingArchiveRequest(task({
      status: 'completed',
      source_task_id: 'source-1',
      result: {
        codex_source_task_completed: true,
        codex_archive_request_state: 'pending',
        codex_archive_requested_at: '2026-06-10T00:00:00.000Z',
      },
    }))).toBe(true);

    expect(hasPendingArchiveRequest(task({
      status: 'completed',
      result: {
        codex_source_task_completed: true,
        codex_archive_request_state: 'waiting_for_grace',
        codex_archive_requested_at: '2026-06-10T00:00:00.000Z',
      },
    }))).toBe(false);

    expect(hasPendingArchiveRequest(task({
      status: 'completed',
      result: {
        codex_source_task_completed: true,
        codex_archive_request_state: 'pending',
        codex_archive_requested_at: '2026-06-10T00:00:00.000Z',
        codex_archive_request_cancelled_at: '2026-06-10T00:00:03.000Z',
      },
    }))).toBe(false);
  });

  test('does not complete a source task just because the Codex thread is archived', () => {
    expect(shouldCompleteSourceFromArchivedThread(task({
      status: 'awaiting_approval',
      source_task_id: 'source-1',
      result: {
        codex_run_state: 'awaiting_approval',
        codex_review_reason: 'archived',
        codex_thread_id: 'thread-1',
      },
    }))).toBe(false);

    expect(shouldCompleteSourceFromArchivedThread(task({
      status: 'completed',
      source_task_id: 'source-1',
      result: {
        codex_source_task_completed: true,
        codex_archive_request_state: 'pending',
        codex_archive_requested_at: '2026-06-10T00:00:00.000Z',
      },
    }))).toBe(true);
  });

  test('marks archived linked threads for history filtering without moving activity time to sync time', async () => {
    const updates: unknown[][] = [];
    const api = {
      updateTaskState: async (...args: unknown[]) => {
        updates.push(args);
      },
    };
    const linkedTask = task({
      status: 'awaiting_approval',
      source_task_id: 'source-1',
      codex_thread_id: 'thread-1',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-10T10:00:00.000Z',
        awaiting_approval_at: '2026-06-10T10:00:00.000Z',
      },
    });

    await markThreadGone(api as never, 'runner-1', linkedTask, 'thread-1', 'archived');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.[0]).toBe('runner-1');
    expect(updates[0]?.[1]).toBe('task-1');
    expect(updates[0]?.[2]).toBe('awaiting_approval');
    const payload = updates[0]?.[3] as { result?: Record<string, unknown>; activity_messages?: Array<Record<string, unknown>> };
    expect(payload.result).toMatchObject({
      codex_review_reason: 'archived',
      codex_thread_archived: true,
      codex_source_task_completed: false,
      last_activity_at: '2026-06-10T10:00:00.000Z',
      awaiting_approval_at: '2026-06-10T10:00:00.000Z',
      meta: {
        thread_archived: true,
      },
    });
    expect(payload.activity_messages?.[0]).toMatchObject({
      kind: 'approval',
      dedupe_key: 'thread:thread-1:archived',
    });
  });

  test('keeps a completed Codex answer in awaiting_approval even when thread updated_at is later than completed_at seconds', () => {
    const raw = [
      line('2026-06-08T15:49:14.929Z', { type: 'task_started', started_at: 1780933754 }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: 'やてひねす' }),
      line('2026-06-08T15:49:18.330Z', {
        type: 'agent_message',
        message: 'すみません、「やてひねす」が何を指しているか読み取れませんでした。',
      }),
      line('2026-06-08T15:49:18.368Z', {
        type: 'task_complete',
        completed_at: 1780933758,
        last_agent_message: 'すみません、「やてひねす」が何を指しているか読み取れませんでした。',
      }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(task(), summary, Date.parse('2026-06-08T15:49:20.000Z'));

    expect(summary.state).toBe('awaiting_approval');
    expect(summary.latestTaskCompleteAt).toBe('2026-06-08T15:49:18.368Z');
    expect(state).toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('summarizes rollout duration and AI history status without treating task_complete as completed', () => {
    const raw = [
      line('2026-06-08T15:49:14.000Z', { type: 'task_started' }),
      line('2026-06-08T15:49:41.000Z', { type: 'task_complete', last_agent_message: '確認してください' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);

    expect(summary.historyStatus).toBe('awaiting_approval');
    expect(summary.startedAt).toBe('2026-06-08T15:49:14.000Z');
    expect(summary.endedAt).toBe('2026-06-08T15:49:41.000Z');
    expect(summary.workDurationSeconds).toBe(27);
  });

  test('marks old Automation AI history without a terminal event as stale awaiting approval metadata', () => {
    const raw = [
      line('2026-06-14T12:35:57.000Z', { type: 'task_started' }),
      line('2026-06-14T12:35:58.000Z', { type: 'user_message', message: 'Automation: LINE派遣面談監査' }),
      line('2026-06-14T12:36:07.000Z', { type: 'function_call_output', output: 'done' }),
    ].join('\n');
    const row = {
      ...threadRow,
      title: 'Automation: LINE派遣面談監査',
      first_user_message: 'Automation ID: line',
      updated_at_ms: Date.parse('2026-06-14T12:36:07.000Z'),
    };
    const summary = parseRollout(raw, row);
    const presentation = aiHistoryPresentationForThread({
      rawRollout: raw,
      row,
      summary,
      nowMs: Date.parse('2026-06-14T12:36:07.000Z') + TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS + 1,
    });

    expect(summary.historyStatus).toBe('running');
    expect(presentation.status).toBe('awaiting_approval');
    expect(presentation.runState).toBe('stale_no_terminal_event');
    expect(presentation.endedAt).toBe('2026-06-14T12:36:07.000Z');
    expect(presentation.workDurationSeconds).toBe(10);
    expect(presentation.staleRunningLastActivityAt).toBe('2026-06-14T12:36:07.000Z');
    expect(presentation.staleRunningThresholdMs).toBe(TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS);
  });

  test('moves non-Automation AI history to stale awaiting approval after the shared stale window', () => {
    const raw = [
      line('2026-06-14T12:35:57.000Z', { type: 'task_started' }),
      line('2026-06-14T12:36:07.000Z', { type: 'function_call_output', output: 'ok' }),
    ].join('\n');
    const row = {
      ...threadRow,
      title: '通常のCodex作業',
      first_user_message: '通常の依頼',
      updated_at_ms: Date.parse('2026-06-14T12:36:07.000Z'),
    };
    const summary = parseRollout(raw, row);

    expect(aiHistoryPresentationForThread({
      rawRollout: raw,
      row,
      summary,
      nowMs: Date.parse('2026-06-14T12:36:07.000Z') + TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS - 1,
    }).status).toBe('running');
    const presentation = aiHistoryPresentationForThread({
      rawRollout: raw,
      row,
      summary,
      nowMs: Date.parse('2026-06-14T12:36:07.000Z') + TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS + 1,
    });
    expect(presentation.status).toBe('awaiting_approval');
    expect(presentation.runState).toBe('stale_no_terminal_event');
  });

  test('marks a user message after completion as resumed running metadata', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:49:15.000Z', { type: 'user_message', message: '追加で見て' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);

    expect(summary.historyStatus).toBe('running');
    expect(summary.activeStartedAt).toBe('2026-06-08T15:49:15.000Z');
  });

  test('shows only the latest completed Codex turn duration in AI history presentation', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:50:00.000Z', { type: 'task_complete', last_agent_message: '初回完了' }),
      line('2026-06-08T16:00:00.000Z', { type: 'user_message', message: '追加で直して' }),
      line('2026-06-08T16:00:30.000Z', { type: 'task_started' }),
      line('2026-06-08T16:02:00.000Z', { type: 'task_complete', last_agent_message: '追加対応完了' }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const presentation = aiHistoryPresentationForThread({
      rawRollout: raw,
      row: threadRow,
      summary,
      nowMs: Date.parse('2026-06-08T16:02:05.000Z'),
    });

    expect(summary.workDurationSeconds).toBe(720);
    expect(presentation.startedAt).toBe('2026-06-08T16:00:30.000Z');
    expect(presentation.endedAt).toBe('2026-06-08T16:02:00.000Z');
    expect(presentation.workDurationSeconds).toBe(90);
  });

  test('does not revive completed AI history from post-complete tool cleanup', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:50:00.000Z', { type: 'function_call', name: 'exec_command' }),
      line('2026-06-08T15:50:03.000Z', { type: 'function_call_output', call_id: 'call-1', output: 'ok' }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const presentation = aiHistoryPresentationForThread({
      rawRollout: raw,
      row: threadRow,
      summary,
      nowMs: Date.parse('2026-06-08T15:50:05.000Z'),
    });

    expect(summary.historyStatus).toBe('awaiting_approval');
    expect(presentation.status).toBe('awaiting_approval');
    expect(presentation.startedAt).toBe('2026-06-08T15:40:00.000Z');
    expect(presentation.endedAt).toBe('2026-06-08T15:40:10.000Z');
    expect(presentation.workDurationSeconds).toBe(10);
  });

  test('starts running AI history duration from the resumed user message when no new task_started exists yet', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:49:15.000Z', { type: 'user_message', message: '追加で見て' }),
      line('2026-06-08T15:49:20.000Z', { type: 'agent_message', message: '調査中です' }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const presentation = aiHistoryPresentationForThread({
      rawRollout: raw,
      row: threadRow,
      summary,
      nowMs: Date.parse('2026-06-08T15:50:00.000Z'),
    });

    expect(presentation.status).toBe('running');
    expect(presentation.startedAt).toBe('2026-06-08T15:49:15.000Z');
    expect(presentation.endedAt).toBeNull();
    expect(presentation.workDurationSeconds).toBe(45);
  });

  test('briefly debounces a running task completion without waiting for thread metadata updates', () => {
    const raw = [
      line('2026-06-08T15:49:14.929Z', { type: 'task_started', started_at: 1780933754 }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: 'やてひねす' }),
      line('2026-06-08T15:49:18.368Z', {
        type: 'task_complete',
        completed_at: 1780933758,
        last_agent_message: '一旦返答しました。',
      }),
    ].join('\n');
    const completeMs = Date.parse('2026-06-08T15:49:18.368Z');
    const threadUpdatedMs = Date.parse('2026-06-08T15:50:35.000Z');
    const summary = parseRollout(raw, {
      ...threadRow,
      updated_at_ms: threadUpdatedMs,
    });
    const runningTask = task();

    expect(summary.state).toBe('awaiting_approval');
    expect(taskStateForSummary(runningTask, summary, completeMs + 500))
      .toEqual({ status: 'running', resumed: false });
    expect(taskStateForSummary(runningTask, summary, completeMs + AWAITING_APPROVAL_STABILITY_MS + 1))
      .toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('treats context compaction before task_complete as Codex running activity', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:20.000Z', { type: 'context_compaction', message: 'Compacting context' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(task(), summary, Date.parse('2026-06-08T15:40:21.000Z'));

    expect(summary.state).toBe('running');
    expect(summary.currentStep).toBe('Codexがコンテキストを整理中');
    expect(summary.latestRunningActivityAt).toBe('2026-06-08T15:40:20.000Z');
    expect(state).toEqual({ status: 'running', resumed: false });
  });

  test('moves a stale running task without a terminal event to awaiting approval', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:20.000Z', { type: 'function_call_output', output: 'still working' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(
      task({ status: 'running', result: { codex_run_state: 'running' } }),
      summary,
      Date.parse('2026-06-08T15:40:20.000Z') + TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS + 1,
    );

    expect(summary.state).toBe('running');
    expect(state).toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('keeps passive context maintenance after task_complete in awaiting approval', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '一旦返答しました' }),
      line('2026-06-08T15:40:20.000Z', { type: 'context_compaction', message: 'Compacting context' }),
      line('2026-06-08T15:40:25.000Z', { type: 'reasoning', summary: [] }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(
      task(),
      summary,
      Date.parse('2026-06-08T15:40:10.000Z') + AWAITING_APPROVAL_STABILITY_MS + 1,
    );

    expect(summary.state).toBe('awaiting_approval');
    expect(summary.currentStep).toBe('Codexが実行完了し確認待ちです');
    expect(summary.latestRunningActivityAt).toBe('2026-06-08T15:40:00.000Z');
    expect(state).toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('does not mark initial prompt_waiting handoff as resumed', () => {
    const raw = [
      line('2026-06-08T15:49:14.929Z', { type: 'task_started', started_at: 1780933754 }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: 'やてひねす' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(task({
      status: 'needs_input',
      result: {
        codex_run_state: 'prompt_waiting',
        last_activity_at: '2026-06-08T15:47:57.527Z',
      },
    }), summary, Date.parse('2026-06-08T15:49:16.000Z'));

    expect(state).toEqual({ status: 'running', resumed: false });
  });

  test('only resumes an awaiting task when a new user prompt or task start appears after the checkpoint', () => {
    const raw = [
      line('2026-06-08T15:49:14.929Z', { type: 'task_started', started_at: 1780933754 }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: '追加で調べて' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-08T15:40:00.000Z',
        awaiting_approval_at: '2026-06-08T15:40:00.000Z',
      },
    }), summary, Date.parse('2026-06-08T15:49:16.000Z'));

    expect(state).toEqual({ status: 'running', resumed: true });
  });

  test('restores running after app restart when tool activity continues after the awaiting checkpoint', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:01.000Z', { type: 'user_message', message: '最初の依頼' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:49:14.929Z', { type: 'reasoning', summary: [] }),
      line('2026-06-08T15:49:15.264Z', { type: 'function_call', name: 'exec_command' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const state = taskStateForSummary(task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-08T15:40:10.000Z',
        awaiting_approval_at: '2026-06-08T15:40:10.000Z',
      },
    }), summary, Date.parse('2026-06-08T15:49:16.000Z'));

    expect(summary.state).toBe('running');
    expect(summary.currentStep).toBe('Codexがコマンドを実行中');
    expect(summary.latestRunningActivityAt).toBe('2026-06-08T15:49:15.264Z');
    expect(state).toEqual({ status: 'running', resumed: true });
  });

  test('keeps a just completed resumed turn running briefly so UI can show the restart', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:01.000Z', { type: 'user_message', message: '最初の依頼' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:49:14.929Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: '追加で調べて' }),
      line('2026-06-08T15:49:18.368Z', { type: 'task_complete', last_agent_message: '追加分も完了しました' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const oldAwaitingTask = task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-08T15:40:10.000Z',
        awaiting_approval_at: '2026-06-08T15:40:10.000Z',
      },
    });
    const resumeMs = Date.parse('2026-06-08T15:49:15.264Z');

    expect(taskStateForSummary(oldAwaitingTask, summary, resumeMs + 1_000))
      .toEqual({ status: 'running', resumed: true });
    expect(taskStateForSummary(oldAwaitingTask, summary, Date.parse('2026-06-08T15:49:18.368Z') + 500))
      .toEqual({ status: 'running', resumed: true });
    expect(taskStateForSummary(oldAwaitingTask, summary, Date.parse('2026-06-08T15:49:18.368Z') + AWAITING_APPROVAL_STABILITY_MS + 1))
      .toEqual({ status: 'awaiting_approval', resumed: true });
  });

  test('advances awaiting approval checkpoint after a resumed turn completes', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:01.000Z', { type: 'user_message', message: '最初の依頼' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '完了しました' }),
      line('2026-06-08T15:49:14.929Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: '追加で調べて' }),
      line('2026-06-08T15:50:18.368Z', { type: 'task_complete', last_agent_message: '追加分も完了しました' }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);
    const oldResult = {
      codex_run_state: 'awaiting_approval',
      last_activity_at: '2026-06-08T15:40:10.000Z',
      awaiting_approval_at: '2026-06-08T15:40:10.000Z',
    };
    const oldAwaitingTask = task({
      status: 'awaiting_approval',
      result: oldResult,
    });
    const state = taskStateForSummary(oldAwaitingTask, summary, Date.parse('2026-06-08T15:50:20.000Z'));
    const nextAwaitingApprovalAt = awaitingApprovalAtForSummary(
      oldResult,
      summary,
      '2026-06-08T15:50:20.000Z',
    );
    const nextState = taskStateForSummary(task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-08T15:50:18.368Z',
        awaiting_approval_at: nextAwaitingApprovalAt,
      },
    }), summary);

    expect(state).toEqual({ status: 'awaiting_approval', resumed: true });
    expect(nextAwaitingApprovalAt).toBe('2026-06-08T15:50:18.368Z');
    expect(nextState).toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('does not return an awaiting task to running from thread updated_at alone', () => {
    const summary = parseRollout('', {
      ...threadRow,
      updated_at_ms: Date.parse('2026-06-08T15:50:00.000Z'),
      preview: 'まだ同じthread',
    });
    const state = taskStateForSummary(task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        last_activity_at: '2026-06-08T15:40:00.000Z',
        awaiting_approval_at: '2026-06-08T15:40:00.000Z',
      },
    }), summary);

    expect(state).toEqual({ status: 'awaiting_approval', resumed: false });
  });

  test('backfills visible Codex chat messages on the first sync after direct thread import', () => {
    const raw = [
      line('2026-06-08T15:49:15.264Z', { type: 'user_message', message: 'SNS投稿の改善案を作って' }),
      line('2026-06-08T15:49:18.330Z', {
        type: 'agent_message',
        message: '投稿案を3パターン作りました。確認してください。',
      }),
      line('2026-06-08T15:49:18.368Z', {
        type: 'task_complete',
        completed_at: 1780933758,
        last_agent_message: '投稿案を3パターン作りました。確認してください。',
      }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const messages = activityMessages(task({
      result: {
        codex_external_origin: 'codex_app_thread_import',
        codex_run_state: 'running',
        last_activity_at: '2026-06-08T15:49:18.368Z',
      },
    }), 'thread-1', summary, false);

    expect(messages.map(message => message.body)).toEqual([
      'SNS投稿の改善案を作って',
      '投稿案を3パターン作りました。確認してください。',
    ]);
  });

  test('converts rollout visible messages into sanitized AI history detail payload', () => {
    const raw = [
      line('2026-06-08T15:49:14.000Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.000Z', { type: 'user_message', message: 'Detailに出す依頼' }),
      line('2026-06-08T15:49:41.000Z', { type: 'task_complete', last_agent_message: '確認してください？' }),
      line('2026-06-08T15:49:42.000Z', { type: 'function_call_output', output: 'raw command output' }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const detailMessages = aiHistoryDetailMessages(threadRow, summary);

    expect(detailMessages).toEqual([
      expect.objectContaining({
        sequence: 2,
        role: 'user',
        kind: 'user_prompt',
        body: 'Detailに出す依頼',
      }),
      expect.objectContaining({
        sequence: 3,
        role: 'assistant',
        kind: 'assistant_question',
        body: '確認してください？',
      }),
    ]);
    expect(JSON.stringify(detailMessages)).not.toContain('raw command output');
  });

  test('adds per-turn work duration metadata to the completed Codex answer after resume', () => {
    const raw = [
      line('2026-06-08T15:40:00.000Z', { type: 'task_started' }),
      line('2026-06-08T15:40:01.000Z', { type: 'user_message', message: '最初の依頼' }),
      line('2026-06-08T15:40:10.000Z', { type: 'task_complete', last_agent_message: '最初の回答です' }),
      line('2026-06-08T15:49:14.000Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.000Z', { type: 'user_message', message: '追加で確認して' }),
      line('2026-06-08T15:49:41.000Z', { type: 'task_complete', last_agent_message: '追加分の回答です' }),
    ].join('\n');
    const summary = parseRollout(raw, threadRow);
    const messages = activityMessages(task({
      status: 'awaiting_approval',
      result: {
        codex_run_state: 'awaiting_approval',
        awaiting_approval_at: '2026-06-08T15:40:10.000Z',
        codex_activity_synced_sequence: 3,
      },
    }), 'thread-1', summary, true);
    const completedMessage = messages.find(message => message.body === '追加分の回答です');

    expect(completedMessage?.metadata).toMatchObject({
      source: 'codex_thread_monitor',
      source_event: 'task_complete',
      turn_started_at: '2026-06-08T15:49:14.000Z',
      turn_completed_at: '2026-06-08T15:49:41.000Z',
      work_elapsed_ms: 27_000,
    });
  });

  test('sends visible Codex messages from the oldest unsynced item in bounded batches', () => {
    const raw = Array.from({ length: 15 }, (_, index) => (
      line(`2026-06-08T15:49:${String(index).padStart(2, '0')}.000Z`, {
        type: 'agent_message',
        message: `進捗 ${index}`,
      })
    )).join('\n');
    const summary = parseRollout(raw, threadRow);

    const firstBatch = activityMessages(task(), 'thread-1', summary, false);
    expect(firstBatch.map(message => message.body)).toEqual(
      Array.from({ length: 12 }, (_, index) => `進捗 ${index}`),
    );

    const nextBatch = activityMessages(task({
      result: {
        codex_run_state: 'running',
        codex_activity_synced_sequence: 12,
      },
    }), 'thread-1', summary, false);
    expect(nextBatch.map(message => message.body)).toEqual(['進捗 12', '進捗 13', '進捗 14']);
  });

  test('uses tool events as lightweight running status updates', () => {
    const raw = [
      line('2026-06-08T15:49:14.929Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.264Z', { type: 'function_call', name: 'exec_command' }),
      line('2026-06-08T15:49:16.264Z', { type: 'function_call_output', call_id: 'call-1', output: 'ok' }),
      line('2026-06-08T15:49:17.264Z', { type: 'reasoning', summary: [] }),
    ].join('\n');

    const summary = parseRollout(raw, threadRow);

    expect(summary.state).toBe('running');
    expect(summary.currentStep).toBe('Codexが内容を検討中');
    expect(parseRollout([
      line('2026-06-08T15:49:14.929Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.264Z', { type: 'function_call', name: 'exec_command' }),
    ].join('\n'), threadRow).currentStep).toBe('Codexがコマンドを実行中');
    expect(parseRollout([
      line('2026-06-08T15:49:14.929Z', { type: 'task_started' }),
      line('2026-06-08T15:49:15.264Z', { type: 'function_call_output', call_id: 'call-1', output: 'ok' }),
    ].join('\n'), threadRow).currentStep).toBe('Codexが実行結果を確認中');
  });

  test('builds known thread ids from column and result before orphan import', () => {
    const ids = knownCodexThreadIds([
      task({ codex_thread_id: 'thread-column' }),
      task({ result: { codex_thread_id: 'thread-result' } }),
      task({ result: {} }),
    ] as never);

    expect([...ids].sort()).toEqual(['thread-column', 'thread-result']);
  });

  test('prioritizes linked active tasks before cold monitor work', () => {
    const baselineTimes = {
      created_at: '2026-06-08T15:30:00.000Z',
      started_at: '2026-06-08T15:30:00.000Z',
    };
    const ordered = prioritizeCodexMonitorTasks([
      task({
        ...baselineTimes,
        id: 'cold-task',
        status: 'completed',
        result: {},
        completed_at: '2026-06-08T15:58:00.000Z',
      }),
      task({
        ...baselineTimes,
        id: 'linked-task',
        status: 'completed',
        codex_thread_id: 'thread-linked',
        result: { codex_run_state: 'awaiting_approval', last_activity_at: '2026-06-08T15:40:00.000Z' },
      }),
      task({
        ...baselineTimes,
        id: 'review-task',
        status: 'awaiting_approval',
        result: { codex_run_state: 'awaiting_approval', last_activity_at: '2026-06-08T15:45:00.000Z' },
      }),
      task({
        ...baselineTimes,
        id: 'running-task',
        status: 'running',
        result: { codex_run_state: 'running', last_activity_at: '2026-06-08T15:42:00.000Z' },
      }),
      task({
        ...baselineTimes,
        id: 'pending-task',
        status: 'pending',
        result: {},
      }),
      task({
        ...baselineTimes,
        id: 'archive-task',
        status: 'completed',
        result: {
          codex_source_task_completed: true,
          codex_archive_request_state: 'pending',
          codex_archive_requested_at: '2026-06-08T15:41:00.000Z',
          last_activity_at: '2026-06-08T15:41:00.000Z',
        },
      }),
    ] as never);

    expect(ordered.map(item => item.id)).toEqual([
      'running-task',
      'review-task',
      'archive-task',
      'linked-task',
      'pending-task',
      'cold-task',
    ]);
  });

  test('keeps the pre-import lane narrow while running tasks are active', () => {
    const ordered = preImportCodexMonitorTasks([
      task({
        id: 'cold-linked-task',
        status: 'completed',
        codex_thread_id: 'thread-linked',
        result: { last_activity_at: '2026-06-08T15:40:00.000Z' },
      }),
      task({
        id: 'review-task',
        status: 'awaiting_approval',
        result: { codex_run_state: 'awaiting_approval', last_activity_at: '2026-06-08T15:45:00.000Z' },
      }),
      task({
        id: 'running-task',
        status: 'running',
        result: { codex_run_state: 'running', last_activity_at: '2026-06-08T15:42:00.000Z' },
      }),
      task({
        id: 'pending-task',
        status: 'pending',
        result: {},
      }),
    ] as never);

    expect(ordered.map(item => item.id)).toEqual(['running-task', 'review-task']);
    expect(shouldDeferOrphanImportForTasks(ordered)).toBe(true);
    expect(orphanImportLimitForPreImportTasks(ordered)).toBe(3);
    expect(shouldDeferOrphanImportForTasks(ordered.filter(item => item.id !== 'running-task'))).toBe(false);
    expect(orphanImportLimitForPreImportTasks(ordered.filter(item => item.id !== 'running-task'))).toBe(30);
  });

  test('imports only recent user-created threads that are not already known', () => {
    const nowMs = Date.parse('2026-06-10T10:00:00.000Z');
    const importScopes = [{
      project_id: 'project-1',
      repo_path: '/Users/me/project',
      enabled_since: '2026-06-10T09:00:00.000Z',
    }];
    const base = {
      ...threadRow,
      id: 'thread-new',
      cwd: '/Users/me/project',
      has_user_event: 0,
      archived: 0,
      first_user_message: 'Codexから直接始めた依頼',
      updated_at_ms: nowMs - 60_000,
    };

    expect(isOrphanThreadImportCandidate(base, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(true);
    expect(isOrphanThreadImportCandidate(base, new Set(['thread-new']), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({ ...base, archived: 1 }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({ ...base, thread_source: 'subagent' }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({ ...base, cwd: '/Users/me/other' }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({ ...base, updated_at_ms: Date.parse('2026-06-10T08:59:59.000Z') }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({
      ...base,
      first_user_message: '# AGENTS.md instructions\n<environment_context>',
    }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({
      ...base,
      title: null,
    }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(true);
    expect(isOrphanThreadImportCandidate({
      ...base,
      title: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももう',
      first_user_message: 'このメモの下の部分なんだけども、このチャットのなんかモダンな雰囲気に合わせて、ボタンとかももうちょっと整えてほしい。詳細も続きます。',
    }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(true);
  });

  test('archives non-user Codex threads in AI history metadata', () => {
    expect(shouldArchiveAiHistoryThread({ archived: 0, thread_source: 'user' })).toBe(false);
    expect(shouldArchiveAiHistoryThread({ archived: 1, thread_source: 'user' })).toBe(true);
    expect(shouldArchiveAiHistoryThread({ archived: 0, thread_source: 'subagent' })).toBe(true);
  });

  test('does not import Focusmap manual handoff threads as orphan repo chats', () => {
    const nowMs = Date.parse('2026-06-10T10:00:00.000Z');
    const importScopes = [{
      project_id: 'project-1',
      repo_path: '/Users/me/project',
      enabled_since: '2026-06-10T09:00:00.000Z',
    }];
    const row = {
      ...threadRow,
      id: 'thread-focusmap-handoff',
      cwd: '/Users/me/project',
      archived: 0,
      first_user_message: 'マインドマップから送ったCodex依頼\n詳細',
      created_at_ms: Date.parse('2026-06-10T09:58:30.000Z'),
      updated_at_ms: Date.parse('2026-06-10T09:59:00.000Z'),
    };
    const handoffTask = task({
      prompt: 'マインドマップから送ったCodex依頼\n詳細',
      cwd: '/Users/me/project',
      source_task_id: 'mindmap-node-1',
      status: 'needs_input',
      result: {
        codex_manual_handoff: true,
        codex_run_state: 'prompt_waiting',
      },
      created_at: '2026-06-10T09:58:00.000Z',
      started_at: '2026-06-10T09:58:00.000Z',
    });

    expect(isFocusmapManualHandoffThread(row, [handoffTask] as never)).toBe(true);
    expect(isFocusmapManualHandoffThread({
      ...row,
      cwd: '/Users/me/project-worktree',
    }, [handoffTask] as never, new Map([['/Users/me/project-worktree', importScopes[0]!]]))).toBe(true);
    expect(isOrphanThreadImportCandidate(
      row,
      new Set(),
      importScopes,
      nowMs,
      10 * 60_000,
      [handoffTask] as never,
    )).toBe(false);
    expect(isFocusmapManualHandoffThread(row, [
      task({
        prompt: 'マインドマップから送ったCodex依頼\n詳細',
        cwd: '/Users/me/project',
        source_task_id: null,
        result: { codex_manual_handoff: true, codex_run_state: 'prompt_waiting' },
      }),
    ] as never)).toBe(false);
  });

  test('matches import scope by repo path and enabled time', () => {
    const updatedMs = Date.parse('2026-06-10T10:00:00.000Z');
    const scopes = [{
      project_id: 'project-1',
      repo_path: '/Users/me/project',
      enabled_since: '2026-06-10T09:30:00.000Z',
    }];

    expect(matchingThreadImportScope({ cwd: '/Users/me/project' }, scopes, updatedMs)?.project_id).toBe('project-1');
    expect(matchingThreadImportScope({ cwd: '/Users/me/project' }, scopes, Date.parse('2026-06-10T09:00:00.000Z'))).toBeNull();
    expect(matchingThreadImportScope(
      { cwd: '/Users/me/project' },
      scopes,
      Date.parse('2026-06-10T09:00:00.000Z'),
      undefined,
      { ignoreEnabledSince: true },
    )?.project_id).toBe('project-1');
    expect(matchingThreadImportScope({ cwd: '/Users/me/other' }, scopes, updatedMs)).toBeNull();
    expect(matchingThreadImportScope(
      { cwd: '/Users/me/project-worktree' },
      scopes,
      updatedMs,
      new Map([['/Users/me/project-worktree', scopes[0]!]]),
    )?.project_id).toBe('project-1');
  });

  test('treats missing orphan import endpoint as temporarily unavailable', () => {
    expect(isOrphanImportApiUnavailable(new AgentApiError('not found', 404, '/agents/codex-monitor/import-thread'))).toBe(true);
    expect(isOrphanImportApiUnavailable(new AgentApiError('method not allowed', 405, '/agents/codex-monitor/import-thread'))).toBe(true);
    expect(isOrphanImportApiUnavailable(new AgentApiError('unauthorized', 401, '/agents/codex-monitor/import-thread'))).toBe(false);
    expect(isOrphanImportApiUnavailable(new AgentApiError('server error', 500, '/agents/codex-monitor/import-thread'))).toBe(false);
  });
});
