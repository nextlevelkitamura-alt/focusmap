import { describe, expect, test } from 'vitest';
import {
  activityMessages,
  codexThreadGeneratedTitle,
  hasPendingArchiveRequest,
  isOrphanImportApiUnavailable,
  isOrphanThreadImportCandidate,
  knownCodexThreadIds,
  matchingThreadImportScope,
  parseRollout,
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
  test('normalizes generated Codex thread titles and ignores raw prompt titles', () => {
    expect(codexThreadGeneratedTitle({ title: '  Codex   thread title  ' })).toBe('Codex thread title');
    expect(codexThreadGeneratedTitle({ title: '# AGENTS.md instructions\n<environment_context>' })).toBeNull();
    expect(codexThreadGeneratedTitle({ title: 'x'.repeat(91) })).toBeNull();
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
    const state = taskStateForSummary(task(), summary);

    expect(summary.state).toBe('awaiting_approval');
    expect(summary.latestTaskCompleteAt).toBe('2026-06-08T15:49:18.368Z');
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
    }), summary);

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
    }), summary);

    expect(state).toEqual({ status: 'running', resumed: true });
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

  test('builds known thread ids from column and result before orphan import', () => {
    const ids = knownCodexThreadIds([
      task({ codex_thread_id: 'thread-column' }),
      task({ result: { codex_thread_id: 'thread-result' } }),
      task({ result: {} }),
    ] as never);

    expect([...ids].sort()).toEqual(['thread-column', 'thread-result']);
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
    expect(isOrphanThreadImportCandidate({ ...base, cwd: '/Users/me/other' }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({ ...base, updated_at_ms: Date.parse('2026-06-10T08:59:59.000Z') }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
    expect(isOrphanThreadImportCandidate({
      ...base,
      first_user_message: '# AGENTS.md instructions\n<environment_context>',
    }, new Set(), importScopes, nowMs, 10 * 60_000)).toBe(false);
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
    expect(matchingThreadImportScope({ cwd: '/Users/me/other' }, scopes, updatedMs)).toBeNull();
  });

  test('treats missing orphan import endpoint as temporarily unavailable', () => {
    expect(isOrphanImportApiUnavailable(new AgentApiError('not found', 404, '/agents/codex-monitor/import-thread'))).toBe(true);
    expect(isOrphanImportApiUnavailable(new AgentApiError('method not allowed', 405, '/agents/codex-monitor/import-thread'))).toBe(true);
    expect(isOrphanImportApiUnavailable(new AgentApiError('unauthorized', 401, '/agents/codex-monitor/import-thread'))).toBe(false);
    expect(isOrphanImportApiUnavailable(new AgentApiError('server error', 500, '/agents/codex-monitor/import-thread'))).toBe(false);
  });
});
