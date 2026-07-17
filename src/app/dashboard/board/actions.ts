'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  approveTodo as approveTodoQuery,
  insertTodo,
  toggleSelfTodoStatus,
  type TodoAssignee,
} from '@/lib/turso/todos';

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

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function computeDoDate(doKind: string, customDate: string): string {
  if (doKind === 'tomorrow') return getJstDate(1);
  if (doKind === 'this_week') return endOfJstWeek(0);
  if (doKind === 'next_week') return endOfJstWeek(1);
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

  if (!title || !repo || (assigneeRaw !== 'self' && assigneeRaw !== 'ai')) {
    redirect(`${ADD_PATH}?addError=1`);
  }

  const assignee = assigneeRaw as TodoAssignee;
  const doDate = computeDoDate(doKind, customDate);

  try {
    await insertTodo({
      title,
      note: note || null,
      doDate,
      dueDate: isValidDate(dueDate) ? dueDate : null,
      repo,
      assignee,
      goalRef: goalRef || null,
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
