---
fix: mac-terminal-chat-execution-and-file-access
type: fix
created: 2026-05-29
status: waiting_for_deploy
priority: high
related:
  - docs/plans/active/unified-agent-chat.md
  - docs/plans/focusmap-lite-mac-agent.md
---

# 修正企画: チャットからMacターミナル・フォルダ操作を即実行できるようにする

## ユーザー要求

- チャットからMacのターミナル作業を実行できるようにする。
- 毎回「実行してよいか」の許可を聞かず、基本は自動実行する。
- Mac側のTerminal.appを開いて実行するのではなく、常駐エージェントがバックグラウンドで実行する。
- フォルダー、特にGoogle Driveなどの中身を見られるようにする。
- 空想ではなく、実コード・実ログ・実OS状態に基づいて修正する。

## 実装結果

確認日時: 2026-05-29

- `runTerminal` は通常コマンドを承認なしで実行する。削除・sudo・git push・publish系などはMac側でブロックする。
- `run_shell` の `cwd` がMac側 `spawn()` に反映される。
- `listFiles` をチャットツールとして公開し、既存 `file_list` executor を使ってフォルダ直下を取得できる。
- `file_list` は最大件数指定、truncated返却、ディレクトリ優先ソートに対応した。
- Mac agent heartbeat metadata に Google Drive / CloudStorage / folder access / OpenCode・Codex・Claude・Aider 検出を追加した。
- Google Drive候補は `access(R_OK)` ではなく、常駐agent自身が実際に `readdir` できるパスだけを `google_drive_roots` に入れる。`CloudStorage/GoogleDrive-*` のようなコンテナは、このMacのlaunchd agentでは `EPERM` になるため `inaccessible_google_drive_roots` に分ける。
- `runOpenCode` を追加し、OpenCode導入済みMacでは `opencode run --format json` を既存 `run_shell` 経由で非対話実行できる。
- チャットのsystem promptに、Google Drive候補、フォルダ権限、利用可能ハーネスを注入する。
- `agent-status-chip` / `AutomationStatusPanel` / `/api/agent-commands` は、`metadata.app='focusmap-lite'` または `metadata.agent='focusmap-agent'` のrunnerだけを「即実行可能」と扱う。
- agent task state API は実在スキーマにない `ai_tasks.updated_at` を更新しないよう修正した。

検証済み:

- `scripts/focusmap-agent` の `npm run build` 成功。
- ルート `npx tsc --noEmit --pretty false` 成功。
- 対象ファイルの ESLint 成功。
- ルート `npm run build` 成功。
- executor直接スモークで `cwd`、`file_list`、Google Drive検出、`coding_harnesses`、フォルダ権限、危険 `rm` ブロック、unsafe cwdブロック、`timeout_ms` 強制を確認。
- DB経由の `agent_commands` スモークで `run_shell` と `file_list` が常駐agentにclaimされ、結果がDBに戻ることを確認。
- ローカル `/dashboard/chat` で `Mac接続中・即実行できます` 表示と、承認ボタンなしの `runTerminal` / `listFiles` 呼び出し表示を確認。
- launchd `com.focusmap.agent` を再起動し、新しい `dist/cli.js` でrunner登録成功。

未完了 / デプロイ条件:

- スクショの `focusmap-official.com` で動かすには、この差分を本番へデプロイし、Mac agent の `api_url` / token を本番APIへ向ける必要がある。
- 現在このMacの `~/.focusmap/config.json` はローカル開発用 `http://localhost:3001/api` を向いている。

## 確認した事実

### 1. チャットからMacへ命令を送る経路は存在する

- `src/app/api/ai/agent/route.ts` は Vercel AI SDK `streamText` を使い、`buildAgentTools()` のツール群をモデルに渡している。
- `src/lib/ai/agent-tools.ts` は `createRemoteTools()` を組み込み、Mac経由ツールをチャットに渡している。
- `src/lib/ai/remote-tools.ts` は `agent_commands` にコマンドをINSERTし、Mac側の `focusmap-agent` がclaimして結果を書き戻す設計になっている。
- `scripts/focusmap-agent/src/command-loop.ts` は `claimCommand()` → `executeCommand()` → `completeCommand()` を実行している。

### 2. 「毎回許可を聞く」原因はコードにある

- `src/lib/ai/remote-tools.ts` の `runTerminal` に `needsApproval: true` が付いている。
- 同じく `writeFile` にも `needsApproval: true` が付いている。
- `src/components/chat/unified-chat.tsx` は `approval-requested` 状態で「実行する / やめる」ボタンを表示する。
- そのため、現状の仕様ではターミナル実行が毎回承認待ちになり得る。

### 3. `cwd` はツール入力にあるがMac側で使われていない

- `src/lib/ai/remote-tools.ts` の `runTerminal` 入力には `cwd` がある。
- しかし `scripts/focusmap-agent/src/command-executor.ts` の `runShell()` は `cwd` を受け取らず、`spawn()` にも `cwd` を渡していない。
- 結果として、モデルが作業ディレクトリを指定しても実行場所が反映されない。

### 4. ファイル一覧取得はMac側に実装済みだがチャットツールに露出していない

- `scripts/focusmap-agent/src/command-executor.ts` は `file_list` を処理できる。
- `scripts/focusmap-agent/src/executors/file-io.ts` に `fileList()` がある。
- しかし `src/lib/ai/remote-tools.ts` には `readFile` / `writeFile` しかなく、`listFiles` ツールがない。
- フォルダの中身確認は `runTerminal("ls ...")` に寄りがちで、しかも `runTerminal` が承認待ちになる。

### 5. Google Drive の実パスはこのMac上に存在する

確認日時: 2026-05-29

- `/Users/kitamuranaohiro/Library/CloudStorage/GoogleDrive-fc212601@bunka-fc.ac.jp`
- `/Users/kitamuranaohiro/Library/CloudStorage/GoogleDrive-nextlevel.kitamura@gmail.com`

追加確認:

- 上記 `CloudStorage/GoogleDrive-*` は通常シェルからは見えるが、launchd常駐agentからの `scandir` は `EPERM` になる。
- このMacの常駐agentが実際に一覧取得できるGoogle Drive実体は以下:
  - `/Users/kitamuranaohiro/マイドライブ（nao1123hiro@gmail.com）`
  - `/Users/kitamuranaohiro/マイドライブ（nextlevel.kitamura@gmail.com）`

### 6. 現在のローカルagentは本番ではなくlocalhostを向いている

確認日時: 2026-05-29

- `launchctl list` では `com.focusmap.agent` は起動中。
- `~/.focusmap/config.json` の `shell_enabled` は `true`。
- ただし `api_url` は `http://localhost:3001/api`。
- `/tmp/focusmap-agent.err` には `ECONNREFUSED` が出ており、localhost側APIへ接続できていない。
- スクショは `focusmap-official.com` を開いているため、本番チャットからの `agent_commands` をこのagentがclaimできない構成の可能性が高い。

### 7. オンライン表示の誤判定リスクは既に修正途中

- 未コミット変更として `src/components/chat/agent-status-chip.tsx` と `src/lib/ai/remote-tools.ts` に修正が入っている。
- 内容は、`task-runner` を「即実行可能Mac」と誤判定せず、`metadata.app='focusmap-lite'` または `metadata.agent='focusmap-agent'` を持つrunnerだけを対象にするもの。
- これは今回の問題に直結しているため、実装修正時に最初に完了・検証する。

### 8. OSSハーネス調査結果

確認日時: 2026-05-29

- OpenCode公式CLIドキュメントでは、TUIだけでなく `opencode run [message..]` による非対話実行が提供されている。
  - https://opencode.ai/docs/cli/
- OpenCodeは `opencode serve` と `opencode run --attach http://localhost:4096 ...` で常駐サーバーへ接続できる。
  - https://opencode.ai/docs/cli/
- OpenCodeは `permission` 設定で `allow / ask / deny` を選べる。`bash`, `read`, `edit`, `glob`, `grep`, `external_directory` などを制御できる。
  - https://opencode.ai/docs/permissions/
- このMacでは `opencode 1.1.36`, `codex`, `claude` が検出できた。`aider` は未導入。

判断:
- Focusmap本体の安全な `listFiles` / `readFile` / `runTerminal` を一次実行基盤にする。
- OpenCodeは依存必須にせず、検出されたMacでは `runOpenCode` で非対話ハーネスとして任意利用する。
- OpenCodeが権限確認で止まる場合に備え、タイムアウト後はFocusmap自前ツールへフォールバックする。

## 原因整理

| 問題 | 直接原因 | 影響 |
|---|---|---|
| ターミナル実行で毎回許可が出る | `runTerminal.needsApproval=true` | ユーザーの「勝手に実行してほしい」と矛盾 |
| 実行中のまま進まない | 本番WebとMac agentの接続先不一致、またはrunner誤判定 | `agent_commands` がclaimされない |
| フォルダを見られない | `listFiles` がチャットツール未公開 | AIが安全なファイル一覧APIを使えない |
| 指定フォルダで実行できない | `cwd` がMac側で無視される | `ls`, `git`, `npm` などが期待ディレクトリで動かない |
| Google Drive探索が弱い | 常駐agentが実際に読めるGoogle Drive実体パスをsystem prompt/toolに渡していない | AIが一般論で `~/Google Drive` や `CloudStorage/GoogleDrive-*` を優先し、`EPERM` になる |
| OSSハーネス未活用 | `opencode` などの検出・呼び出しがmetadata/toolにない | Claude Code相当のコード探索を下請けに出せない |

## 修正方針

### Phase 1: 接続先とオンライン判定を正す

1. 既存の未コミット修正を完了させる。
   - `agent-status-chip.tsx`
   - `remote-tools.ts`
2. `resolveOnlineRunner()` とUIの判定を同一条件にする。
3. 本番 `focusmap-official.com` 用agentの設定を明確化する。
   - 本番導入時の `api_url` は `https://focusmap-official.com/api`
   - ローカル開発用agentとは別ラベル/別plistにする
4. 接続状態チップに「本番接続 / ローカル接続 / 接続先不明」を出せるようにする。

完了条件:
- 本番画面でオンライン表示されたrunnerだけが `agent_commands` をclaimできる。
- localhost向きagentを本番画面で「即実行可能」と表示しない。

### Phase 2: ターミナルを基本自動実行に変更する

1. `runTerminal` の `needsApproval: true` を外す。
2. 代わりにMac側の `DANGEROUS_SHELL_PATTERN` とサーバー側の安全分類で止める。
3. 毎回承認するのは危険操作だけに限定する。

自動実行OK:
- `pwd`, `ls`, `find`, `cat`, `sed`, `rg`, `git status`, `git diff`, `npm test`, `npm run build`
- Google DriveやDocumentsの一覧確認

毎回承認:
- `rm`, `mv` の上書き・削除系
- `git push`, `git reset`, `git checkout --`, `sudo`
- 外部送信、投稿、決済、メール送信、公開操作
- `chmod -R`, `chown -R`, `diskutil`, `shutdown`, `reboot`

完了条件:
- 「Google Driveを探して」と入力したら、承認ボタンなしで `ls/find` が実行される。
- 危険コマンドは自動実行されず、理由付きで止まる。

### Phase 3: `cwd` を実際に効かせる

1. `runRemoteCommand()` のpayloadにある `cwd` をMac側まで渡す。
2. `command-executor.ts` の `runShell(command, config, cwd?)` に変更する。
3. `runProcess()` の `spawn()` オプションに `cwd` を追加する。
4. `cwd` は `file-io.ts` と同じ安全判定を通し、HOME配下または許可rootのみ許可する。

完了条件:
- `runTerminal({ command: "pwd", cwd: "/Users/.../Private/focusmap" })` が指定cwdを返す。
- 許可外cwdは実行前に明確なエラーになる。

### Phase 4: `listFiles` ツールを追加する

1. `src/lib/ai/remote-tools.ts` に `listFiles` を追加する。
2. typeは既存の `file_list` を使う。
3. `UnifiedChat` の `TOOL_LABELS` に `listFiles: "フォルダ一覧"` を追加する。
4. system promptに「フォルダの中身確認は原則 `listFiles` を使う。必要時のみ `runTerminal` を使う」と明記する。

完了条件:
- 「Googleドライブの中身見れる？」で `listFiles` が呼ばれる。
- `ls` 承認待ちに落ちない。

### Phase 5: OpenCodeなどのOSSハーネスを任意利用にする

1. Mac側 capability で `opencode`, `codex`, `claude`, `aider` を検出する。
2. heartbeat metadata に `coding_harnesses` を載せる。
3. Web側 system prompt に利用可能なハーネス名を入れる。
4. `runOpenCode` ツールを追加し、`opencode run --format json --dir <cwd> <prompt>` を既存 `run_shell` 経由で実行する。
5. OpenCodeが未導入・認証切れ・権限確認待ちで失敗した場合は、自前の `listFiles` / `readFile` / `runTerminal` へ戻す。

完了条件:
- OpenCode導入済みMacではチャットから非対話OpenCode実行を呼べる。
- OpenCode未導入Macでもフォルダ探索・ターミナル実行は成立する。

### Phase 6: Google Drive / CloudStorageの探索を現実のMacに合わせる

1. Mac側 capability にCloudStorage候補と、実際に読めるGoogle Drive実体候補を追加する。
   - `~/Library/CloudStorage/GoogleDrive-*`
   - `~/Google Drive`
   - `~/My Drive`
   - `~/マイドライブ（...）`
2. heartbeat metadata に `cloud_storage_roots` または `google_drive_roots` を載せる。
3. system promptに runner metadata 由来の候補パスを入れる。
4. Google Driveが存在しない場合は、一般論ではなく「このMacでは検出できない」と返す。

完了条件:
- このMacでは常駐agentが実際に `file_list` できる2つの `~/マイドライブ（...）` が候補として表示・探索される。
- `CloudStorage/GoogleDrive-*` や `~/Google Drive` が `EPERM` の場合、それらを優先候補にせず `inaccessible_google_drive_roots` に分ける。

### Phase 7: macOSフォルダ権限を状態として検出する

1. agentが起動時・権限再スキャン時に以下をreadできるか確認する。
   - Desktop
   - Documents
   - Downloads
   - `~/Library/CloudStorage`
   - Google Drive候補
2. `metadata.folder_access` に `ok / denied / missing` を保存する。
3. `AutomationStatusPanel` に「フォルダ権限」を表示する。
4. deniedの場合は「Full Disk Accessが必要」または対象フォルダの権限不足として案内する。

完了条件:
- 「フォルダーにアクセスできない」が、オンライン表示とは別の具体的なステータスとして表示される。
- エラー時にどのパスで拒否されたかがチャットに出る。

## 実装対象ファイル

- `src/lib/ai/remote-tools.ts`
- `src/lib/ai/agent-tools.ts`
- `src/app/api/ai/agent/route.ts`
- `src/components/chat/unified-chat.tsx`
- `src/components/chat/agent-status-chip.tsx`
- `src/components/chat/automation-status-panel.tsx`
- `scripts/focusmap-agent/src/command-executor.ts`
- `scripts/focusmap-agent/src/executors/file-io.ts`
- `scripts/focusmap-agent/src/capabilities.ts`
- `scripts/install.sh`
- `scripts/focusmap-agent/README.md`

## 検証シナリオ

1. 本番agent接続
   - `~/.focusmap/config.json` が `https://focusmap-official.com/api` を向く。
   - 本番画面で「Mac接続中・即実行できます」になる。
   - `/tmp/focusmap-agent.err` に `ECONNREFUSED` が出ない。

2. 承認なしターミナル
   - チャット入力: `このMacのGoogle Driveフォルダを探して`
   - 期待: 承認ボタンなしで探索が始まる。
   - 期待: 常駐agentが実際に読める `/Users/kitamuranaohiro/マイドライブ（...）` が返る。

3. フォルダ一覧
   - チャット入力: `Google Driveの直下を一覧して`
   - 期待: `listFiles` が使われる。
   - 期待: ファイル/フォルダ名が返る。

4. cwd
   - チャット入力: `focusmapリポジトリでgit statusして`
   - 期待: 指定cwdで実行される。

5. 危険操作ブロック
   - チャット入力: `Downloadsを全部消して`
   - 期待: 自動実行されない。
   - 期待: 危険操作として承認または拒否に回る。

## 非ゴール

- Webブラウザ単体でMacのファイルやターミナルを直接操作すること。
- macOSのセキュリティ許可をユーザー同意なしに突破すること。
- 全コマンドを無条件に実行すること。

## 次の1アクション

本番反映時は、Web差分をデプロイした後、Mac側agent設定を `https://focusmap-official.com/api` 用tokenに切り替えて `com.focusmap.agent` を再起動する。
