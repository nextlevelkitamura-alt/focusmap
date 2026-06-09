# Mistakes

再発防止が必要な失敗だけを記録する。小さな一度きりのtypoや原因未確認の推測は入れない。

## Open / Watching

- Macアプリの外部ブラウザログイン完了は、Next/Cloud Runのプロセス内メモリだけをhandoff正本にしない。`/api/auth/desktop-session` ポーリングはフォールバックとして残しつつ、`focusmap://auth-complete` のようなMacローカル到達経路とpending nonce検証を併用する。
- Codex manual handoffの初回同期は、既存thread_idの監視だけに寄せない。スマホからCodexへコピーした直後はai_tasksにthread_idが未保存のため、agent APIは直近のmanual handoffを返し、Mac側で同期ID/first_user_messageからthreadを発見できる必要がある。
- Codex threadの `updated_at_ms` だけを確認待ち後の再開根拠にしない。`task_complete.completed_at` は秒精度、thread更新はミリ秒精度なので、完了直後の数ms差で「回答済み」を `running` に戻す事故が起きる。再開根拠はcheckpoint以降の `user_message` / `task_started` に限定する。
- Codexの `task_complete` や `thread_deleted` をマップノード完了の根拠にしない。`task_complete` は内容確認前なので `確認待ち`、`thread_deleted` は監視不能なので `確認待ち`、ユーザー意思の完了シグナルとして扱うのはCodex threadの `archived` とFocusmap側チェックだけにする。
