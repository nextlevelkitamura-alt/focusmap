# Mistakes

再発防止が必要な失敗だけを記録する。小さな一度きりのtypoや原因未確認の推測は入れない。

## Open / Watching

- 小さな修正・UI調整・ドキュメント変更で、作業開始時の現在ブランチが `main` 以外だった場合、そのまま現在ブランチで進めない。`git status --short --branch` で現在地を見た時点で、ユーザーがブランチ作業を明示していなければ既存の `main` worktree へ移る。未コミット差分などで `main` を使えない場合だけ、`origin/main` 起点の一時 worktree で隔離して作業し、完了時は `local main` へ取り込む。push は明示依頼時のみ。2026-06-11 に小修正を `fix/codex-kanban-current-map-actions` へ push して main に反映されない事故が起きた。
- Macアプリの外部ブラウザログイン完了は、Next/Cloud Runのプロセス内メモリだけをhandoff正本にしない。`/api/auth/desktop-session` ポーリングはフォールバックとして残しつつ、`focusmap://auth-complete` のようなMacローカル到達経路とpending nonce検証を併用する。
- Macアプリ起動時のremote UI cache/service worker削除をdashboard表示の必須前処理にしない。Electronの `clearCache()` / `clearStorageData()` が解決しないと `Focusmap 起動中` のまま止まり、retryも同じpending promiseで固まる。cache clearは短いtimeout付きのbest effortにし、保存済みセッションCookie復元後はdashboard `loadURL` へ必ず進める。
- Codex manual handoffの初回同期は、既存thread_idの監視だけに寄せない。スマホからCodexへコピーした直後はai_tasksにthread_idが未保存のため、agent APIは直近のmanual handoffを返し、Mac側で同期ID/first_user_messageからthreadを発見できる必要がある。
- Focusmap Macアプリ同梱のCodex監視コードを更新せずに使い続けない。Codex Desktopのstate DBが `~/.codex/sqlite/state_5.sqlite` へ移った後も、古いbundleが旧 `~/.codex/state_5.sqlite` を読むと実在threadを見失う。見失っただけで `thread_deleted` として永久除外せず、`thread_unavailable` / `awaiting_approval` で監視継続にする。Macアプリ、`focusmap-agent`、`/api/codex/sync-node`、互換runnerは同じresolverを使い、bundle更新後は再インストール/再起動を確認する。
- Codex threadの `updated_at_ms` だけを確認待ち後の再開根拠にしない。`task_complete.completed_at` は秒精度、thread更新はミリ秒精度なので、完了直後の数ms差で「回答済み」を `running` に戻す事故が起きる。再開根拠はcheckpoint以降の `user_message` / `task_started` に限定する。
- Codex threadが `task_complete` 後に再開しているかを見る時は、`user_message` / `task_started` だけでなく、checkpoint以降の `reasoning` / `function_call` / `custom_tool_call` / tool output も軽い実行中activityとして見る。Codex.app再起動後やFocusmapアプリ再起動後は、ユーザー発話イベントを取り逃がしてもtool activityが続いていれば `running` へ復帰できる必要がある。ただし最新が `task_complete` なら `確認待ち` に戻す。
- Codexの `task_complete` や `thread_unavailable` をマップノード完了の根拠にしない。`task_complete` は内容確認前なので `確認待ち`、`thread_unavailable` は一時未検出なので監視継続の `確認待ち`、ユーザー意思の完了シグナルとして扱うのはCodex threadの `archived` とFocusmap側チェック/削除だけにする。
- 実行中taskの進捗保護を理由に、Codex孤立thread取り込みを完全停止しない。広いreconcileと低優先度post-import同期は後ろへ回してよいが、直近のAI履歴を取り込むhot importは小さな上限で継続しないと、ユーザーからは「AI履歴監視が止まった」「表示が遅い」に見える。
- Codexチャット取り込みサイドバーや看板のようにユーザーが監視画面を開いている状態では、task-progress snapshotを通常の長いpoll周期に戻さない。詳細panelだけを短周期条件にすると、取り込み一覧を見ているのに実行中/確認待ちの表示が遅れる。
