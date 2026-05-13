# Google OAuth Verification 完全パッケージ（Focusmap）

このファイル1つで「申請に必要なテキスト・撮影台本・チェックリスト・申請手順」が全部揃う前提でまとめている。撮影日にこのファイルを開いたまま録画すれば順番通り進む。

---

## 0. このアプリの審査前提

| 項目 | 値 |
|------|----|
| アプリ名（同意画面と一致必須） | **Focusmap** |
| Homepage URL | `https://shikumika-app-364jgme3ja-an.a.run.app/` |
| Privacy Policy URL | `https://shikumika-app-364jgme3ja-an.a.run.app/privacy` |
| Terms URL | `https://shikumika-app-364jgme3ja-an.a.run.app/terms` |
| Authorized domain | `shikumika-app-364jgme3ja-an.a.run.app` |
| Redirect URI | `https://shikumika-app-364jgme3ja-an.a.run.app/api/calendar/callback` |
| サポートメール | nextlevel.kitamura@gmail.com |
| 申請するScope | `calendar.events`（sensitive）<br>`calendar.calendarlist.readonly`（sensitive） |

> **注意**: `*.run.app` ドメインは Google Search Console での所有権確認ができない。本番審査前にカスタムドメイン取得→そちらに切り替え必要。詳細は §8 参照。

---

## 1. 撮影前チェックリスト（録画ボタンを押す前に全部✓）

### 1-1. ドメイン・OAuth設定（Google Cloud Console）

- [ ] OAuth Consent Screen の **App name** が `Focusmap` ちょうど（大文字小文字含む一致）
- [ ] **App logo** 設定済み（120x120 PNG推奨）
- [ ] **Application home page** が上記Homepage URLと完全一致
- [ ] **Application privacy policy link** が上記Privacy URLと完全一致
- [ ] **Application terms of service link** が上記Terms URLと完全一致
- [ ] **Authorized domains** に本番ドメインを登録済み
- [ ] **Scopes** に `calendar.events` と `calendar.calendarlist.readonly` の **2つだけ** を追加（多すぎると審査落ち）
- [ ] OAuth Client の **Authorized redirect URIs** に本番callback URLが登録済み
- [ ] テストユーザーまたは publishing status = `In production` で誰でも認可フローを通せる状態

### 1-2. アプリ側（focusmap）

- [ ] 本番（Cloud Run）に最新コードがデプロイ済み（このPR含む）
- [ ] `/` を開くと Homepage が表示される
- [ ] `/privacy` を開くと **§7 Limited Use** と **§8 English Summary** が表示される
- [ ] `/login` から Google ログインできる
- [ ] ログイン後 `/dashboard` のカレンダー設定で「連携する」ボタンが見える
- [ ] 「連携解除」ボタンが見える（録画でrevoke動作を見せるため）

### 1-3. 録画環境

- [ ] **ブラウザ言語をEnglish (US) に変更**（同意画面が英語表示になる必須要件）
  - Chrome: 設定 → Languages → English を先頭に → 再起動
  - もしくは Chromeのゲストプロファイル / 別プロファイルで英語UIに
- [ ] 画面サイズ **1920x1080** で固定（QuickTime / ScreenStudio）
- [ ] アドレスバーが常時見える状態（ブックマークバー以外のツールバーは非表示）
- [ ] 個人情報が映る他タブ・通知は全部閉じる（Slack/メール通知OFF）
- [ ] 録画用のGoogleアカウントを使う（普段使いのアカウントは使わない）
- [ ] 念のため、`https://myaccount.google.com/permissions` を一度確認して、過去のFocusmap認可を **削除しておく**（録画では「初回同意」を見せる必要があるため）

### 1-4. 字幕（音声ナレーションなし運用）

本プロジェクトは **音声ナレーションを使わず、字幕（テキストオーバーレイ）のみで進める**。Google審査要件は "Voice **or** text narration" なので字幕単独で要件を満たす。

- [ ] §4 の字幕タイミング表が確定している
- [ ] Remotion または同等のコードベース編集環境がセットアップ済み
- [ ] 撮影中はマイクOFF（環境音が入らないようにする）

---

## 2. 録画ワークフロー（順番通り、画面の見せ方も明記）

### ステージ A. オープニング（0:00–0:25）

| 操作 | 画面 | 注意 |
|------|------|------|
| 1 | ホームページ `/` を表示 | URLバーに本番ドメインが見える状態 |
| 2 | Focusmapロゴ・タイトル・3つの説明を見せる | ゆっくりスクロール |
| 3 | "Google Calendar integration" のセクションを画面中央に映す（**`calendar.events` / `calendar.calendarlist.readonly` が見える状態**） | 1.5秒静止 |

### ステージ B. プライバシーポリシー提示（0:25–0:50）

| 操作 | 画面 | 注意 |
|------|------|------|
| 4 | `/privacy` に遷移 | URLバー見せる |
| 5 | §7 "Googleユーザーデータの取り扱い（Limited Use準拠）" にスクロール | 静止2秒 |
| 6 | §8 English Summary にスクロール | "will adhere to the Google API Services User Data Policy, including the Limited Use requirements" の英文を中央に1.5秒静止 |

### ステージ C. サインイン（0:50–1:20）

| 操作 | 画面 | 注意 |
|------|------|------|
| 7 | `/login` でGoogleログインボタン押下 | 標準のGoogle Sign-In同意画面（"Sign in with Google"）が出る |
| 8 | テストアカウントを選択 | 個人情報モザイク不要（テスト用なので） |
| 9 | `/dashboard` 着地 | ヘッダ"Focusmap"が見える |

### ステージ D. OAuth Consent Screen（最重要、1:20–2:00）

| 操作 | 画面 | 注意 |
|------|------|------|
| 10 | カレンダー設定を開く | サイドバーまたは設定画面 |
| 11 | 「連携する」ボタンを押す | クリック前に1秒静止して見せる |
| 12 | Google OAuth同意画面が表示される | **画面全体が映ること** |
| 13 | アドレスバーに `client_id=` が含まれているのを **1秒静止して見せる** | 必須 |
| 14 | 同意画面で **App name = Focusmap**、開発者メールが映ることを見せる | |
| 15 | "Focusmap wants access to your Google Account" の下までスクロールし、以下2つのscope表示が見えることを確認 | **必須** |
|  | ・"See, edit, share, and permanently delete all the calendars you can access using Google Calendar" | calendar.events 相当の英文 |
|  | ・"See the list of Google calendars you're subscribed to" | calendar.calendarlist.readonly 相当の英文 |
| 16 | Privacy Policy / Terms of Service リンクが表示されているのを見せる | 1秒静止 |
| 17 | "Continue" を押す | |

### ステージ E. calendar.calendarlist.readonly の使用（2:00–2:45）

| 操作 | 画面 | 注意 |
|------|------|------|
| 18 | 連携完了後、ユーザーのカレンダー一覧UIを開く | `/api/calendars` から取得した一覧が表示されている |
| 19 | カレンダーを2つほどチェック/アンチェック | 「ユーザーが取り込み対象を選べる」=このscopeの目的、を見せる |
| 20 | ナレーションで「This calendar list is fetched via calendar.calendarlist.readonly, read-only.」と説明 | |

### ステージ F. calendar.events の使用：READ（2:45–3:30）

| 操作 | 画面 | 注意 |
|------|------|------|
| 21 | Todayビューを開いて、Googleカレンダーから読み込まれた予定が並ぶ様子を映す | 「This is data fetched via calendar.events scope」と説明 |
| 22 | 1件クリックして詳細（タイトル・時間・説明）が表示される | |

### ステージ G. calendar.events の使用：WRITE（3:30–4:30）★最重要

| 操作 | 画面 | 注意 |
|------|------|------|
| 23 | Focusmap内でタスクを1件作成 → カレンダーに予定として書き込む操作 | UIで「カレンダーに追加」 |
| 24 | **別タブで `calendar.google.com` を開く** | 同じテストアカウント |
| 25 | 作成した予定が反映されていることを画面で確認 | 1.5秒静止 |
| 26 | Focusmapに戻り、その予定を編集 | 時間変更など |
| 27 | カレンダー側で更新が反映されている様子 | 1.5秒静止 |
| 28 | Focusmapで予定を削除 | |
| 29 | カレンダー側で消えている様子 | 1.5秒静止 |

### ステージ H. アクセス取り消し（4:30–5:00）

| 操作 | 画面 | 注意 |
|------|------|------|
| 30 | Focusmapのカレンダー設定で「連携解除」ボタンを押す | |
| 31 | 確認ダイアログでOK | |
| 32 | 連携解除後の状態（未連携表示）を見せる | |
| 33 | ナレーションで「Users can also revoke at https://myaccount.google.com/permissions anytime」と説明 | |

### ステージ I. クロージング（5:00–5:15）

- "Thank you for reviewing Focusmap." のテキストオーバーレイ
- 連絡先メール表示

---

## 3. 動画の総尺目安

- 推奨: **4〜6分**
- 5分超でも全scopeの READ + WRITE + REVOKE がカバーされていれば問題なし
- 1.5倍速や2倍速は使わない（審査で評価しにくくなる）

---

## 4. 字幕タイミング表（Remotion等で自動編集する前提）

**運用ルール**:
- 字幕は **画面下部中央**、半透明黒ボックス + 白文字（最低36pxフォント）
- 一度に表示する文字数は **80字以内**、2行まで
- 表示時間は最低 **2秒**、長文は2〜3カットに分割
- 撮影された素材の各ステージ先頭からの相対時間で `start` / `end` を持つ
- 言語は **英語**（同意画面が英語必須なので字幕も英語で統一）

### 字幕シーン定義（コピペでRemotionに渡せるフォーマット）

```json
[
  { "stage": "A1", "start": 0,   "end": 4,   "text": "Demo for OAuth verification — Focusmap" },
  { "stage": "A2", "start": 4,   "end": 9,   "text": "A task and calendar dashboard that uses Google Calendar." },
  { "stage": "A3", "start": 9,   "end": 14,  "text": "We request two scopes: calendar.events and calendar.calendarlist.readonly." },

  { "stage": "B1", "start": 14,  "end": 19,  "text": "Privacy policy — Section 7 covers Google API Services User Data Policy compliance." },
  { "stage": "B2", "start": 19,  "end": 24,  "text": "Section 8 contains the English Limited Use disclosure." },
  { "stage": "B3", "start": 24,  "end": 29,  "text": "No advertising use. No data sale. No human reads user data without consent." },

  { "stage": "C1", "start": 29,  "end": 34,  "text": "Step 1 — The user signs in with Google." },

  { "stage": "D1", "start": 34,  "end": 39,  "text": "Step 2 — The user clicks Connect Google Calendar inside Focusmap." },
  { "stage": "D2", "start": 39,  "end": 44,  "text": "OAuth consent screen — app name 'Focusmap' is shown." },
  { "stage": "D3", "start": 44,  "end": 49,  "text": "Address bar contains the OAuth client_id." },
  { "stage": "D4", "start": 49,  "end": 55,  "text": "Scopes requested: calendar.events and calendar.calendarlist.readonly." },
  { "stage": "D5", "start": 55,  "end": 60,  "text": "Privacy policy and terms of service links are visible. User clicks Continue." },

  { "stage": "E1", "start": 60,  "end": 65,  "text": "calendar.calendarlist.readonly — fetch the list of the user's calendars." },
  { "stage": "E2", "start": 65,  "end": 71,  "text": "Read-only. User picks which calendars Focusmap should sync." },

  { "stage": "F1", "start": 71,  "end": 76,  "text": "calendar.events (READ) — upcoming events are displayed in Focusmap." },
  { "stage": "F2", "start": 76,  "end": 81,  "text": "Today's schedule appears alongside the user's tasks." },

  { "stage": "G1", "start": 81,  "end": 86,  "text": "calendar.events (WRITE) — user creates a task in Focusmap." },
  { "stage": "G2", "start": 86,  "end": 91,  "text": "Focusmap calls events.insert. The event appears in Google Calendar." },
  { "stage": "G3", "start": 91,  "end": 96,  "text": "User edits the event in Focusmap — events.update reflects on Google Calendar." },
  { "stage": "G4", "start": 96,  "end": 102, "text": "User deletes the event in Focusmap — events.delete reflects on Google Calendar." },
  { "stage": "G5", "start": 102, "end": 107, "text": "All write operations are triggered by an explicit user action." },

  { "stage": "H1", "start": 107, "end": 112, "text": "Disconnect — stored OAuth tokens are deleted." },
  { "stage": "H2", "start": 112, "end": 117, "text": "Users can also revoke access at myaccount.google.com/permissions." },

  { "stage": "I1", "start": 117, "end": 122, "text": "End-to-end flow and all scopes demonstrated. Thank you for reviewing." }
]
```

※ `start` / `end` は秒。素材の長さに応じて編集時にスケール調整する。各ステージの本数だけは固定し、`end` の値だけ均等に伸縮させればOK。

---

## 4.5. 素材引き渡しフォーマット（北村→Claudeへ渡す）

撮影した動画素材を以下の形式でリポジトリに置いてもらえれば、Claude側でRemotionスクリプトを書いて自動編集できる。

### 推奨ディレクトリ

```
docs/oauth-verification-assets/
  raw/
    stage-A-opening.mp4
    stage-B-privacy.mp4
    stage-C-signin.mp4
    stage-D-consent.mp4          ← 最重要
    stage-E-calendarlist.mp4
    stage-F-events-read.mp4
    stage-G-events-write.mp4     ← 最重要（READ→CREATE→UPDATE→DELETE が1本でも分割でもOK）
    stage-H-revoke.mp4
    stage-I-closing.mp4          ← 静止画でもOK
  logo/
    focusmap-logo.png            ← 120x120 透過PNG（OAuth Consent Screen用と兼用）
  README.md                      ← 撮影メモ（NGテイクや注意点）
```

### 各ファイルの撮り方ルール

- 解像度 1920x1080、30fps以上
- ステージごとに **1ファイル**（途中で切れててもOK、繋ぎはClaudeがやる）
- 音声は **無音 or マイクOFF**（環境音が入っていたら後で削除する）
- §2 の各ステージ操作を順番通りに行う
- ファイル名は上記のまま（編集スクリプトがファイル名で識別する）

### 撮り直しが必要になる典型ケース

- 同意画面が日本語表示 → ブラウザ言語を英語に変えて全部撮り直し
- アプリ名が "shikumika" 等の旧名で映っている → OAuth Consent Screenのapp nameを修正後に撮り直し
- アドレスバーが切れている → ブラウザのズーム/ウィンドウサイズ調整
- 通知バナーや個人アカウントの情報が映り込んだ → そのカットだけ撮り直し

### Claude側の編集タスク（素材が揃ったら実行）

1. Remotion プロジェクトを `docs/oauth-verification-assets/editor/` に作成
2. 上記JSONをタイムライン定義として読み込み、字幕レイヤーを自動生成
3. 各ステージMP4を `<OffthreadVideo>` で順番に連結
4. ステージ境界に短いクロスフェード（0.3s）を入れる
5. オープニング/クロージングは Remotion で生成（背景 + ロゴ + テキスト）
6. `npm run build` で 1080p mp4 出力
7. 出力先 `docs/oauth-verification-assets/out/focusmap-oauth-demo.mp4`

### 北村側がやること（編集後）

- 出力された mp4 を確認
- YouTube Studio にアップロード → Visibility: **Unlisted**
- 動画タイトル: `Focusmap OAuth verification demo`
- 説明欄: §6 の Scope Justification 抜粋でOK
- 動画URLをGoogle Cloud Consoleの申請フォームに貼る

---

## 5. OAuth Consent Screen の各フィールドに入れる申請テキスト

### App name
```
Focusmap
```

### User support email
```
nextlevel.kitamura@gmail.com
```

### App logo
- 120x120 PNG（透過背景）を別途用意

### Application home page
```
https://shikumika-app-364jgme3ja-an.a.run.app/
```

### Application privacy policy link
```
https://shikumika-app-364jgme3ja-an.a.run.app/privacy
```

### Application terms of service link
```
https://shikumika-app-364jgme3ja-an.a.run.app/terms
```

### Authorized domains
```
shikumika-app-364jgme3ja-an.a.run.app
```
※ §8 を参照。`*.run.app` は所有権検証できない可能性が高いので、本番審査前にカスタムドメインへ。

### Developer contact information
```
nextlevel.kitamura@gmail.com
```

---

## 6. Scope Justification（申請フォームに貼り付けるテキスト）

### `https://www.googleapis.com/auth/calendar.events`

```
Focusmap requests the calendar.events scope so that the user can manage their tasks
and calendar events in one place. With this scope Focusmap (1) reads upcoming events
from the user's selected Google calendars and displays them next to the user's tasks
on the Today view, and (2) creates, updates, and deletes events on the user's
calendar when the user explicitly schedules, reschedules, or removes a task inside
Focusmap. Write operations are always triggered by an explicit user action.

We cannot use a narrower scope such as calendar.events.readonly because Focusmap's
core feature is two-way synchronization: tasks scheduled inside Focusmap must be
written back to the user's Google Calendar so the user sees a single source of truth
across their devices. Without write access the product cannot deliver its value.
```

### `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

```
Focusmap requests calendar.calendarlist.readonly so that the user can choose which
of their Google calendars Focusmap should read events from and which calendar new
events should be written to. We use this scope only to list the calendars the user
is subscribed to (id, summary, background color, primary flag) and to display the
list in our calendar selection UI. No write access is involved; we use the read-only
variant intentionally so we cannot modify the user's calendar list.
```

---

## 7. Limited Use Disclosure（フォームの該当欄に貼る）

```
Focusmap's use and transfer of information received from Google APIs to any other
app will adhere to the Google API Services User Data Policy, including the Limited
Use requirements.

- Focusmap uses Google user data only to provide and improve user-facing features
  that are prominent in Focusmap's UI (task/calendar synchronization).
- Focusmap does not use or transfer Google user data for serving advertisements,
  including retargeting, personalized, or interest-based advertising.
- Focusmap does not allow humans to read Google user data unless we obtain explicit
  consent from the user, it is necessary for security purposes, it is required by
  applicable law, or the data is aggregated and anonymized for internal operations.
- Focusmap does not sell Google user data.
```

---

## 8. 残ブロッカー / 撮影前に潰すべきリスク

### 8-1. 認可ドメインの問題（最大の懸念）

Google OAuth verification では Search Console でドメイン所有権の確認が必要。`*.run.app` は **Google保有ドメイン** なのでユーザーは所有権を証明できない。  
→ 本番審査の前に **カスタムドメイン**（例: `focusmap.app` / `focusmap.io` 等）を取得して Cloud Run にマップする必要がある。  

**やること**:
- [ ] カスタムドメインを取得
- [ ] Cloud Run の Domain Mappings で接続
- [ ] DNS設定
- [ ] Search Console で所有権確認
- [ ] OAuth Consent Screen の Homepage / Privacy / Terms / Authorized domain を全部新ドメインへ更新
- [ ] アプリ側の `NEXTAUTH_URL` / `GOOGLE_REDIRECT_URI` / Supabase の Redirect URLs も更新

撮影自体は古いドメインでも内容としては成立するが、**最終的に審査に出すバージョンはカスタムドメインで撮り直し**になる可能性が高い。先にドメイン確定する方が手戻りが少ない。

### 8-2. App logo

OAuth同意画面に出るロゴ（120x120 PNG）は未設定の可能性。動画でも同意画面にロゴが見えると審査員の心証が良くなる。

**やること**:
- [ ] Focusmap のロゴ画像（120x120 PNG, 透過背景）を作成 or 既存資材から流用
- [ ] OAuth Consent Screen にアップロード

### 8-3. ブラウザ言語の英語化

同意画面が日本語で映ると審査で差し戻される。Chromeを英語UIにできる準備を撮影日までに済ませる。

### 8-4. アプリの安定性

撮影中にエラーが出ると撮り直し。撮影前日に「Connect → 一覧表示 → 予定READ → 予定CREATE → 予定UPDATE → 予定DELETE → Disconnect」を一通り通して動作確認しておく。

---

## 9. 撮影日のワークフロー（順序固定）

1. §1 のチェックリスト全✓
2. ブラウザを英語UIで起動
3. 録画ソフト準備（音声入力テスト）
4. §2 のステージA〜Iを **一発撮り** を目指す（ミスったら頭から）
5. 撮影後、§4 の英語ナレーションを字幕として焼き込む（音声版なら録音→重ね）
6. mp4 書き出し（1080p）
7. YouTube Studio にアップ → **Visibility: Unlisted** → 動画タイトル `Focusmap OAuth verification demo` に
8. 動画URLを §6・§7 のテキストと一緒に Google Cloud Console の申請フォームに貼って提出

---

## 10. 提出後

- 通常 **3〜5営業日**で初回レスポンス
- 差し戻し（"Action required"）の典型理由は §1 と §8 のチェックで先回り潰し済み
- 差し戻された場合は、差し戻し内容を本ファイルの §11 に追記して再撮影
