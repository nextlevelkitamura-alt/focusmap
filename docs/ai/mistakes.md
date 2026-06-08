# Mistakes

再発防止が必要な失敗だけを記録する。小さな一度きりのtypoや原因未確認の推測は入れない。

## Open / Watching

- Codex manual handoffの初回同期は、既存thread_idの監視だけに寄せない。スマホからCodexへコピーした直後はai_tasksにthread_idが未保存のため、agent APIは直近のmanual handoffを返し、Mac側で同期ID/first_user_messageからthreadを発見できる必要がある。
- Codex threadの `updated_at_ms` だけを確認待ち後の再開根拠にしない。`task_complete.completed_at` は秒精度、thread更新はミリ秒精度なので、完了直後の数ms差で「回答済み」を `running` に戻す事故が起きる。再開根拠はcheckpoint以降の `user_message` / `task_started` に限定する。
