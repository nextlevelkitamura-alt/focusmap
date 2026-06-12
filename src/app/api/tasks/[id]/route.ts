import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { deleteTaskFromCalendar } from '@/lib/google-calendar';
import {
  readMindmapLinks,
  removeManualMappedColumn,
  removeMindmapLinksForTaskIds,
  shouldPreserveMemoColumn,
} from '@/lib/mindmap-memo-links';
import type { Database } from '@/types/database';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type MemoNodeLinkRow = Database['public']['Tables']['memo_node_links']['Row'];
type MemoItemRow = Database['public']['Tables']['memo_items']['Row'];
type WishlistMemoSnapshot = Pick<
  Database['public']['Tables']['ideal_goals']['Row'],
  'id' | 'is_completed' | 'is_today' | 'memo_status' | 'scheduled_at' | 'google_event_id' | 'ai_source_payload'
>;
type DeletedTaskMemoRepairSnapshot = {
  deleted_task_ids: string[];
  structured_links: MemoNodeLinkRow[];
  memo_items: MemoItemRow[];
  wishlist_items: WishlistMemoSnapshot[];
};

function hasMindmapTaskLink(payload: unknown, taskId: string): boolean {
  return readMindmapLinks(payload).some(link => link.task_id === taskId);
}

function hasAnyMindmapTaskLink(payload: unknown, taskIds: Set<string>): boolean {
  return readMindmapLinks(payload).some(link =>
    typeof link.task_id === 'string' && taskIds.has(link.task_id)
  );
}

function hasManualMappedColumn(payload: unknown): boolean {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    (payload as { manual_column?: unknown }).manual_column === 'mapped'
  );
}

async function getDeletedTaskIds(
  supabase: SupabaseServerClient,
  userId: string,
  rootTaskId: string,
) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, parent_task_id')
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error || !data) {
    if (error) console.error('[tasks/[id] DELETE] Failed to load task descendants:', error);
    return [rootTaskId];
  }

  const childrenByParent = new Map<string, string[]>();
  for (const task of data) {
    if (!task.parent_task_id) continue;
    const children = childrenByParent.get(task.parent_task_id) ?? [];
    children.push(task.id);
    childrenByParent.set(task.parent_task_id, children);
  }

  const ids: string[] = [];
  const visit = (taskId: string) => {
    ids.push(taskId);
    for (const childId of childrenByParent.get(taskId) ?? []) {
      visit(childId);
    }
  };
  visit(rootTaskId);
  return Array.from(new Set(ids));
}

async function cleanupDeletedTaskMemoState(
  supabase: SupabaseServerClient,
  userId: string,
  deletedTaskIds: string[],
) {
  const deletedTaskIdSet = new Set(deletedTaskIds);
  const now = new Date().toISOString();
  const snapshot: DeletedTaskMemoRepairSnapshot = {
    deleted_task_ids: deletedTaskIds,
    structured_links: [],
    memo_items: [],
    wishlist_items: [],
  };

  const { data: structuredLinks, error: structuredLinksError } = await supabase
    .from('memo_node_links')
    .select('*')
    .eq('user_id', userId)
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')
    .in('task_id', deletedTaskIds);

  if (structuredLinksError) {
    console.error('[tasks/[id] DELETE] Failed to load structured memo links:', structuredLinksError);
  }

  const activeStructuredLinks = structuredLinks ?? [];
  snapshot.structured_links = activeStructuredLinks as MemoNodeLinkRow[];
  const structuredLinkIds = activeStructuredLinks
    .map(link => link.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const memoItemIds = Array.from(new Set(
    activeStructuredLinks
      .map(link => link.memo_item_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  ));
  const wishlistSourceIds = new Set(
    activeStructuredLinks
      .filter(link => link.source_type === 'wishlist')
      .map(link => link.source_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  if (memoItemIds.length > 0) {
    const { data: memoItems, error: memoItemsError } = await supabase
      .from('memo_items')
      .select('*')
      .eq('user_id', userId)
      .in('id', memoItemIds);
    if (memoItemsError) {
      console.error('[tasks/[id] DELETE] Failed to snapshot memo_items:', memoItemsError);
    } else {
      snapshot.memo_items = (memoItems ?? []) as MemoItemRow[];
    }
  }

  if (structuredLinkIds.length > 0) {
    const { error } = await supabase
      .from('memo_node_links')
      .update({ status: 'archived', updated_at: now })
      .eq('user_id', userId)
      .in('id', structuredLinkIds);
    if (error) {
      console.error('[tasks/[id] DELETE] Failed to archive memo_node_links:', error);
    }
  }

  const { data: legacyCandidates, error: legacyError } = await supabase
    .from('ideal_goals')
    .select('id, is_completed, is_today, memo_status, scheduled_at, google_event_id, ai_source_payload')
    .eq('user_id', userId)
    .in('status', ['wishlist', 'memo'])
    .not('ai_source_payload', 'is', null);

  if (legacyError) {
    console.error('[tasks/[id] DELETE] Failed to load legacy memo links:', legacyError);
  } else {
    for (const memo of legacyCandidates ?? []) {
      if (hasAnyMindmapTaskLink(memo.ai_source_payload, deletedTaskIdSet)) {
        wishlistSourceIds.add(memo.id);
      }
    }
  }

  const affectedWishlistIds = [...wishlistSourceIds];
  if (affectedWishlistIds.length === 0) return snapshot;

  const { data: wishlistItems, error: wishlistSnapshotError } = await supabase
    .from('ideal_goals')
    .select('id, is_completed, is_today, memo_status, scheduled_at, google_event_id, ai_source_payload')
    .eq('user_id', userId)
    .in('id', affectedWishlistIds);

  if (wishlistSnapshotError) {
    console.error('[tasks/[id] DELETE] Failed to snapshot linked wishlist items:', wishlistSnapshotError);
    return snapshot;
  }

  const wishlistRows = wishlistItems ?? [];
  snapshot.wishlist_items = wishlistRows as WishlistMemoSnapshot[];

  const { data: remainingStructuredLinks, error: remainingStructuredError } = await supabase
    .from('memo_node_links')
    .select('source_id, task_id')
    .eq('user_id', userId)
    .eq('source_type', 'wishlist')
    .eq('link_type', 'mindmap_node')
    .eq('status', 'active')
    .in('source_id', affectedWishlistIds);

  if (remainingStructuredError) {
    console.error('[tasks/[id] DELETE] Failed to load remaining structured memo links:', remainingStructuredError);
  }

  const remainingStructuredBySourceId = new Map<string, number>();
  for (const link of remainingStructuredLinks ?? []) {
    if (!link.source_id || !link.task_id || deletedTaskIdSet.has(link.task_id)) continue;
    remainingStructuredBySourceId.set(link.source_id, (remainingStructuredBySourceId.get(link.source_id) ?? 0) + 1);
  }

  await Promise.all(wishlistRows.map(async memo => {
    const legacyRepair = removeMindmapLinksForTaskIds(memo.ai_source_payload, deletedTaskIdSet);
    const remainingLegacyCount = legacyRepair.remainingLinks.filter(link => typeof link.task_id === 'string').length;
    const hasRemainingMap = remainingLegacyCount > 0 || (remainingStructuredBySourceId.get(memo.id) ?? 0) > 0;
    let nextPayload: Record<string, unknown> = legacyRepair.payload;
    if (!hasRemainingMap) {
      nextPayload = removeManualMappedColumn(nextPayload);
    }

    const shouldResetToUnsorted =
      !hasRemainingMap &&
      (legacyRepair.removedLinks.length > 0 || hasManualMappedColumn(memo.ai_source_payload) || wishlistSourceIds.has(memo.id)) &&
      !shouldPreserveMemoColumn(memo);
    const updates: Record<string, unknown> = {
      ai_source_payload: nextPayload,
      updated_at: now,
    };
    if (shouldResetToUnsorted) updates.memo_status = 'unsorted';

    const { error } = await supabase
      .from('ideal_goals')
      .update(updates)
      .eq('id', memo.id)
      .eq('user_id', userId);
    if (error) {
      console.error('[tasks/[id] DELETE] Failed to reset linked wishlist memo:', error);
    }
  }));

  return snapshot;
}

async function restoreDeletedTaskMemoStateSnapshot(
  supabase: SupabaseServerClient,
  userId: string,
  snapshot: DeletedTaskMemoRepairSnapshot,
) {
  const structuredLinks = snapshot.structured_links ?? [];
  if (structuredLinks.length > 0) {
    const { error } = await supabase.from('memo_node_links').upsert(structuredLinks);
    if (error) console.error('[tasks/[id] DELETE] Failed to restore structured memo links:', error);
  }

  const memoItems = snapshot.memo_items ?? [];
  if (memoItems.length > 0) {
    const { error } = await supabase.from('memo_items').upsert(memoItems);
    if (error) console.error('[tasks/[id] DELETE] Failed to restore memo_items:', error);
  }

  const wishlistItems = snapshot.wishlist_items ?? [];
  await Promise.all(wishlistItems.map(async item => {
    if (typeof item.id !== 'string') return;
    const { id, ...updates } = item;
    const { error } = await supabase
      .from('ideal_goals')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) console.error('[tasks/[id] DELETE] Failed to restore wishlist memo:', error);
  }));
}

function normalizeTokyoDateString(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === 'string' || value instanceof Date
    ? new Date(value)
    : new Date();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

async function syncGoogleEventCompletionForTask(
  supabase: SupabaseServerClient,
  userId: string,
  task: {
    google_event_id: string | null;
    calendar_id: string | null;
    scheduled_at: string | null;
    status: string;
  }
) {
  if (!task.google_event_id) return;

  const isCompleted = task.status === 'done';
  const completedDate = normalizeTokyoDateString(task.scheduled_at);
  if (!completedDate) {
    console.warn('[tasks/[id] PATCH] Skip event completion sync: invalid scheduled_at', {
      taskGoogleEventId: task.google_event_id,
      scheduledAt: task.scheduled_at,
    });
    return;
  }

  let updateQuery = supabase
    .from('calendar_events')
    .update({ is_completed: isCompleted })
    .eq('user_id', userId)
    .eq('google_event_id', task.google_event_id);

  if (task.calendar_id) {
    updateQuery = updateQuery.eq('calendar_id', task.calendar_id);
  }

  const updateResult = await updateQuery.select('id, calendar_id');
  let updatedRows = updateResult.data;

  if (updateResult.error) {
    console.error('[tasks/[id] PATCH] Failed to sync calendar_events completion:', updateResult.error);
    return;
  }

  if (task.calendar_id && (!updatedRows || updatedRows.length === 0)) {
    const retry = await supabase
      .from('calendar_events')
      .update({ is_completed: isCompleted })
      .eq('user_id', userId)
      .eq('google_event_id', task.google_event_id)
      .select('id, calendar_id');

    if (retry.error) {
      console.error('[tasks/[id] PATCH] Failed to retry calendar_events completion sync:', retry.error);
      return;
    }

    updatedRows = retry.data;
  }

  const calendarId = updatedRows?.[0]?.calendar_id || task.calendar_id;

  if (isCompleted) {
    if (!calendarId) {
      console.warn('[tasks/[id] PATCH] Skip event completion sidecar: missing calendar_id', {
        google_event_id: task.google_event_id,
        completedDate,
      });
      return;
    }

    const { error } = await supabase
      .from('event_completions')
      .upsert({
        user_id: userId,
        google_event_id: task.google_event_id,
        calendar_id: calendarId,
        completed_date: completedDate,
      }, {
        onConflict: 'user_id,google_event_id,completed_date',
      });

    if (error) {
      console.error('[tasks/[id] PATCH] Failed to upsert event completion sidecar:', error);
    }
    return;
  }

  const { error } = await supabase
    .from('event_completions')
    .delete()
    .eq('user_id', userId)
    .eq('google_event_id', task.google_event_id)
    .eq('completed_date', completedDate);

  if (error) {
    console.error('[tasks/[id] PATCH] Failed to delete event completion sidecar:', error);
  }
}

/**
 * タスクを取得
 * GET /api/tasks/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;

    // タスクを取得
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      task
    });

  } catch (error: unknown) {
    console.error('[tasks/[id]] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to fetch task')
        }
      },
      { status: 500 }
    );
  }
}

/**
 * タスクを削除（関連するGoogleカレンダーイベントも削除）
 * DELETE /api/tasks/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;

    // タスクを取得（google_event_idとcalendar_idを確認するため）
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    // Googleカレンダーイベントを削除（存在する場合）
    if (task.google_event_id) {
      try {
        console.log('[tasks/[id] DELETE] Deleting Google Calendar event:', task.google_event_id);
        await deleteTaskFromCalendar(
          user.id,
          taskId,
          task.google_event_id,
          task.calendar_id || undefined
        );
        console.log('[tasks/[id] DELETE] Google Calendar event deleted');
      } catch (calendarError: unknown) {
        console.error('[tasks/[id] DELETE] Failed to delete Google Calendar event:', calendarError);
        // カレンダー削除が失敗してもタスク削除は続行
      }
    }

    const deletedTaskIds = await getDeletedTaskIds(supabase, user.id, taskId);
    const memoRepairSnapshot = await cleanupDeletedTaskMemoState(supabase, user.id, deletedTaskIds);

    // タスクを削除
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', user.id);

    if (deleteError) {
      await restoreDeletedTaskMemoStateSnapshot(supabase, user.id, memoRepairSnapshot);
      console.error('[tasks/[id] DELETE] Failed to delete task:', deleteError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DELETE_ERROR',
            message: 'Failed to delete task'
          }
        },
        { status: 500 }
      );
    }

    console.log('[tasks/[id] DELETE] Task deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'Task deleted successfully',
      memo_repair: memoRepairSnapshot,
    });
  } catch (error: unknown) {
    console.error('[tasks/[id] DELETE] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to delete task')
        }
      },
      { status: 500 }
    );
  }
}

/**
 * タスクを更新（関連するGoogleカレンダーイベントも更新）
 * PATCH /api/tasks/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // 認証チェック
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  try {
    const taskId = id;
    const body = await request.json();

    // タスクを取得（google_event_idとcalendar_idを確認するため）
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task not found'
          }
        },
        { status: 404 }
      );
    }

    const updatePayload = {
      ...body,
      updated_at: new Date().toISOString()
    };

    let updatedTask;
    let updateError;

    if (body.status !== undefined && task.source === 'google_event' && task.google_event_id) {
      const result = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('user_id', user.id)
        .eq('google_event_id', task.google_event_id)
        .is('deleted_at', null)
        .select();

      updateError = result.error;
      updatedTask = result.data?.find(row => row.id === taskId) ?? result.data?.[0] ?? null;
    } else {
      const result = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', taskId)
        .eq('user_id', user.id)
        .select()
        .single();

      updateError = result.error;
      updatedTask = result.data;
    }

    if (updateError) {
      console.error('[tasks/[id] PATCH] Failed to update task:', updateError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UPDATE_ERROR',
            message: 'Failed to update task'
          }
        },
        { status: 500 }
      );
    }

    if (body.status !== undefined && updatedTask) {
      const linkedMemoStatus = updatedTask.status === 'done'
        ? 'done'
        : (updatedTask.scheduled_at ? 'scheduled' : 'task');
      const linkedWishlistCompleted = updatedTask.status === 'done';
      const linkedWishlistMemoStatus = linkedWishlistCompleted
        ? 'completed'
        : (updatedTask.scheduled_at ? 'scheduled' : 'organized');
      const linkedWishlistUpdates: Record<string, unknown> = {
        is_completed: linkedWishlistCompleted,
        memo_status: linkedWishlistMemoStatus,
        updated_at: new Date().toISOString(),
      };
      if (linkedWishlistCompleted) {
        linkedWishlistUpdates.is_today = false;
      }

      try {
        const { data: memoLinks, error: memoLinksError } = await supabase
          .from('memo_node_links')
          .select('memo_item_id, source_type, source_id')
          .eq('user_id', user.id)
          .eq('task_id', taskId)
          .eq('link_type', 'mindmap_node')
          .eq('status', 'active');

        if (memoLinksError) {
          console.error('[tasks/[id] PATCH] Failed to load linked memo items:', memoLinksError);
        } else {
          const memoItemIds = Array.from(new Set(
            (memoLinks ?? [])
              .map(link => link.memo_item_id)
              .filter((memoItemId): memoItemId is string => typeof memoItemId === 'string' && memoItemId.length > 0)
          ));
          const wishlistSourceIds = new Set(
            (memoLinks ?? [])
              .filter(link => link.source_type === 'wishlist')
              .map(link => link.source_id)
              .filter((sourceId): sourceId is string => typeof sourceId === 'string' && sourceId.length > 0)
          );

          if (memoItemIds.length > 0) {
            const { error: memoItemUpdateError } = await supabase
              .from('memo_items')
              .update({
                status: linkedMemoStatus,
                updated_at: new Date().toISOString(),
              })
              .eq('user_id', user.id)
              .in('id', memoItemIds);

            if (memoItemUpdateError) {
              console.error('[tasks/[id] PATCH] Failed to sync structured memo status:', memoItemUpdateError);
            }
          }

          if (wishlistSourceIds.size > 0) {
            const { error: wishlistUpdateError } = await supabase
              .from('ideal_goals')
              .update(linkedWishlistUpdates)
              .eq('user_id', user.id)
              .in('id', [...wishlistSourceIds]);

            if (wishlistUpdateError) {
              console.error('[tasks/[id] PATCH] Failed to sync linked wishlist status:', wishlistUpdateError);
            }
          }
        }

        const { data: legacyLinkedMemos, error: legacyLinkedMemosError } = await supabase
          .from('ideal_goals')
          .select('id, ai_source_payload')
          .eq('user_id', user.id)
          .in('status', ['wishlist', 'memo'])
          .not('ai_source_payload', 'is', null);

        if (legacyLinkedMemosError) {
          console.error('[tasks/[id] PATCH] Failed to load legacy linked wishlist items:', legacyLinkedMemosError);
        } else {
          const legacyWishlistIds = (legacyLinkedMemos ?? [])
            .filter(memo => hasMindmapTaskLink(memo.ai_source_payload, taskId))
            .map(memo => memo.id)
            .filter((memoId): memoId is string => typeof memoId === 'string' && memoId.length > 0);

          if (legacyWishlistIds.length > 0) {
            const { error: legacyWishlistUpdateError } = await supabase
              .from('ideal_goals')
              .update(linkedWishlistUpdates)
              .eq('user_id', user.id)
              .in('id', legacyWishlistIds);

            if (legacyWishlistUpdateError) {
              console.error('[tasks/[id] PATCH] Failed to sync legacy linked wishlist status:', legacyWishlistUpdateError);
            }
          }
        }
      } catch (memoSyncError) {
        console.error('[tasks/[id] PATCH] Failed to sync structured memo status:', memoSyncError);
      }
    }

    // Googleカレンダーイベントも更新（存在する場合）
    if (task.google_event_id && updatedTask) {
      try {
        if (body.status !== undefined) {
          await syncGoogleEventCompletionForTask(supabase, user.id, {
            google_event_id: task.google_event_id,
            calendar_id: updatedTask.calendar_id ?? task.calendar_id,
            scheduled_at: updatedTask.scheduled_at ?? task.scheduled_at,
            status: updatedTask.status ?? body.status,
          });
        }

        // タイトル、予定時刻、推定時間が変更された場合のみカレンダーも更新
        const shouldUpdateCalendar =
          body.title !== undefined ||
          body.scheduled_at !== undefined ||
          body.estimated_time !== undefined ||
          body.memo !== undefined ||
          body.calendar_id !== undefined;

        if (shouldUpdateCalendar) {
          console.log('[tasks/[id] PATCH] Updating Google Calendar event:', task.google_event_id);

          const { syncTaskToCalendar } = await import('@/lib/google-calendar');
          await syncTaskToCalendar(user.id, taskId, {
            title: updatedTask.title,
            scheduled_at: updatedTask.scheduled_at,
            estimated_time: updatedTask.estimated_time || 60,
            google_event_id: task.google_event_id,
            calendar_id: updatedTask.calendar_id || task.calendar_id || 'primary',
            source_calendar_id: task.calendar_id || updatedTask.calendar_id || 'primary',
            memo: updatedTask.memo
          });

          console.log('[tasks/[id] PATCH] Google Calendar event updated');
        }
      } catch (calendarError: unknown) {
        console.error('[tasks/[id] PATCH] Failed to update Google Calendar event:', calendarError);
        // カレンダー更新が失敗してもタスク更新は成功とする
      }

      const shouldUpdateLinkedMemo =
        body.title !== undefined ||
        body.scheduled_at !== undefined ||
        body.estimated_time !== undefined;

      if (shouldUpdateLinkedMemo) {
        const memoUpdates: Record<string, unknown> = {
          scheduled_at: updatedTask.scheduled_at,
          duration_minutes: updatedTask.estimated_time || 60,
          memo_status: 'scheduled',
          updated_at: new Date().toISOString(),
        };
        if (body.title !== undefined) {
          memoUpdates.title = updatedTask.title;
        }

        try {
          const { error: memoUpdateError } = await supabase
            .from('ideal_goals')
            .update(memoUpdates)
            .eq('user_id', user.id)
            .eq('google_event_id', task.google_event_id);

          if (memoUpdateError) {
            console.error('[tasks/[id] PATCH] Failed to update linked memo:', memoUpdateError);
          }
        } catch (memoUpdateError) {
          console.error('[tasks/[id] PATCH] Failed to update linked memo:', memoUpdateError);
        }
      }
    }

    console.log('[tasks/[id] PATCH] Task updated successfully');

    return NextResponse.json({
      success: true,
      task: updatedTask,
      message: 'Task updated successfully'
    });

  } catch (error: unknown) {
    console.error('[tasks/[id] PATCH] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: getErrorMessage(error, 'Failed to update task')
        }
      },
      { status: 500 }
    );
  }
}
