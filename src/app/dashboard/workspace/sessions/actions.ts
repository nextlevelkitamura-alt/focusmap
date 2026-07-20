'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getPersonalOsInboxClient } from '@/lib/turso/client';

const SESSIONS_PATH = '/dashboard/workspace/sessions';

function getJstDate() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export async function addGoal(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return;

  const goalDate = getJstDate();
  let failed = false;

  try {
    await getPersonalOsInboxClient().execute({
      sql: `
        INSERT INTO goals (name, goal_date, created_at, source, status)
        VALUES (?, ?, ?, 'web', 'pending')
      `,
      args: [name, goalDate, new Date().toISOString()],
    });
  } catch {
    failed = true;
  }

  revalidatePath(SESSIONS_PATH);

  const params = new URLSearchParams({ date: goalDate });
  params.set(failed ? 'addError' : 'added', '1');
  redirect(`${SESSIONS_PATH}?${params.toString()}`);
}
