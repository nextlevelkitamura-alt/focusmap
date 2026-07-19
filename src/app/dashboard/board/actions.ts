'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  answerTodoQuestion,
  approveTodo as approveTodoQuery,
  carryOverTodo,
  completeAiTodoHeading,
  insertTodo,
  reattachFixStep,
  toggleSelfTodoStatus,
  undoCompleteAiTodoHeading,
  type TodoAssignee,
} from '@/lib/turso/todos';
import { archiveTheme, insertTheme, updateTheme } from '@/lib/turso/themes';
import { fileAgentToFinished } from '@/lib/turso/personal-os-board';

const BOARD_PATH = '/dashboard/board';
const ADD_PATH = '/dashboard/board/add';

function getJstDate(offsetDays = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function endOfJstWeek(offsetWeeks: number) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = now.getUTCDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  now.setUTCDate(now.getUTCDate() + daysUntilSunday + offsetWeeks * 7);
  return now.toISOString().slice(0, 10);
}

// 「来週」= 来週月曜（JST）。docs/CONTEXT.md と子計画01の宣言に一致させる
function startOfNextJstWeek() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = now.getUTCDay();
  const daysUntilNextMonday = (8 - day) % 7 || 7;
  now.setUTCDate(now.getUTCDate() + daysUntilNextMonday);
  return now.toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function computeDoDate(doKind: string, customDate: string): string {
  if (doKind === 'tomorrow') return getJstDate(1);
  if (doKind === 'this_week') return endOfJstWeek(0);
  if (doKind === 'next_week') return startOfNextJstWeek();
  if (doKind === 'custom' && isValidDate(customDate)) return customDate;
  return getJstDate(0);
}

export async function addTodo(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const doKind = String(formData.get('doKind') ?? 'today');
  const customDate = String(formData.get('customDate') ?? '');
  const repo = String(formData.get('repo') ?? '').trim();
  const assigneeRaw = String(formData.get('assignee') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  const dueDate = String(formData.get('dueDate') ?? '').trim();
  const goalRef = String(formData.get('goalRef') ?? '').trim();
  // 子09: テーマ選択（新規作成は "__new__" ＋ newThemeName）。未選択は「未分類」。
  const themeChoice = String(formData.get('themeId') ?? '').trim();
  const newThemeName = String(formData.get('newThemeName') ?? '').trim();

  if (!title || !repo || (assigneeRaw !== 'self' && assigneeRaw !== 'ai')) {
    redirect(`${ADD_PATH}?addError=1`);
  }

  const assignee = assigneeRaw as TodoAssignee;
  const doDate = computeDoDate(doKind, customDate);

  try {
    // テーマ「新規作成」を選んだ時は名前だけで即席作成（目的・完了条件は空＝未記入バッジ・人間の空作成は可）。
    let themeId: string | null = themeChoice && themeChoice !== '__new__' ? themeChoice : null;
    if (themeChoice === '__new__' && newThemeName) {
      themeId = await insertTheme({ name: newThemeName });
    }
    await insertTodo({
      title,
      note: note || null,
      doDate,
      dueDate: isValidDate(dueDate) ? dueDate : null,
      repo,
      assignee,
      goalRef: goalRef || null,
      themeId,
    });
  } catch {
    redirect(`${ADD_PATH}?addError=1`);
  }

  revalidatePath(BOARD_PATH);
  redirect(`${BOARD_PATH}?date=${doDate}&added=1`);
}

export async function approveTodoAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id) {
    await approveTodoQuery(id);
    revalidatePath(BOARD_PATH);
  }

  redirect(date ? `${BOARD_PATH}?date=${date}` : BOARD_PATH);
}

export async function toggleTodoAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const nextStatus = String(formData.get('nextStatus') ?? '') === 'done' ? 'done' : 'open';
  const date = String(formData.get('date') ?? '');

  if (id) {
    await toggleSelfTodoStatus(id, nextStatus);
    revalidatePath(BOARD_PATH);
  }

  redirect(date ? `${BOARD_PATH}?date=${date}` : BOARD_PATH);
}

function boardRedirect(date: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  redirect(query ? `${BOARD_PATH}?${query}` : BOARD_PATH);
}

// 段階2: 見出しの完了は人間のタップのみ。完了後は 5秒取り消し（undo）用に justCompleted を渡す。
export async function completeHeadingAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id) {
    const done = await completeAiTodoHeading(id);
    revalidatePath(BOARD_PATH);
    if (done) boardRedirect(date, { justCompleted: id });
  }

  boardRedirect(date);
}

export async function undoCompleteAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id) {
    await undoCompleteAiTodoHeading(id);
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 段階4: スマホからの質問回答（選択肢タップ / 自由入力）をDB保存。
export async function answerQuestionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const answer = String(formData.get('answer') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id && answer.trim()) {
    await answerTodoQuestion(id, answer);
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 段階3: 手直し(fix)行を別タスクへ1タップ付け替え。
export async function reattachFixAction(formData: FormData) {
  const stepId = String(formData.get('stepId') ?? '');
  const targetTodoId = String(formData.get('targetTodoId') ?? '');
  const date = String(formData.get('date') ?? '');

  if (stepId && targetTodoId) {
    await reattachFixStep(stepId, targetTodoId);
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 子09: テーマ作成（ボード上の即席作成）。目的・完了条件は任意（空可＝未記入バッジ）。
export async function addThemeAction(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const doneCriteria = String(formData.get('doneCriteria') ?? '').trim();
  const goalRef = String(formData.get('goalRef') ?? '').trim();
  const date = String(formData.get('date') ?? '');

  if (name) {
    await insertTheme({
      name,
      purpose: purpose || null,
      doneCriteria: doneCriteria || null,
      goalRef: goalRef || null,
    });
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 子09: テーマ編集（インライン鉛筆）。目的・完了条件を人間が直せる。
export async function updateThemeAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const doneCriteria = String(formData.get('doneCriteria') ?? '').trim();
  const goalRef = String(formData.get('goalRef') ?? '').trim();
  const date = String(formData.get('date') ?? '');

  if (id && name) {
    await updateTheme({
      id,
      name,
      purpose: purpose || null,
      doneCriteria: doneCriteria || null,
      goalRef: goalRef || null,
    });
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 子09: テーマのアーカイブ（論理削除）。配下タスクは「未分類」に落ちる（theme_id は温存）。
export async function archiveThemeAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id) {
    await archiveTheme(id);
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 子09 繰越し: 未完了タスクを翌日へ1タップ移動（do_date+1・carried_from初回記録）。
// 人間タップのみ（AIが勝手に日付を動かさない）。移動先の翌日ボードで「昨日から」表示。
export async function carryOverAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('date') ?? '');

  if (id) {
    await carryOverTodo(id);
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}

// 子09 エージェント行の人間チェック（方針6）: 宣言済み todo_id を読むだけで格納先を決め、
// 「終わったこと」へ格納（タスク入れ子 or 新見出し）。状態機械（run/wait/sub）は書き換えない。
export async function fileAgentAction(formData: FormData) {
  const sessionKey = String(formData.get('sessionKey') ?? '');
  const todoTitle = String(formData.get('todoTitle') ?? '');
  const date = String(formData.get('date') ?? '');

  if (sessionKey) {
    await fileAgentToFinished(sessionKey, todoTitle, date || getJstDate(0));
    revalidatePath(BOARD_PATH);
  }

  boardRedirect(date);
}
