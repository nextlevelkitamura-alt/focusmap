alter table public.ai_task_activity_messages
  drop constraint if exists ai_task_activity_messages_kind_check;

alter table public.ai_task_activity_messages
  add constraint ai_task_activity_messages_kind_check
  check (kind in (
    'prompt_waiting',
    'sent',
    'progress',
    'question',
    'approval',
    'resumed',
    'completed',
    'failed',
    'user_answer'
  ));
