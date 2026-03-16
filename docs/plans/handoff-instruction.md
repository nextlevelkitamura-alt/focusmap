# shikumika AI基盤リニューアル — 引き継ぎ指示

## これは何か
人生管理リポジトリで企画・設計した内容を、shikumika リポジトリの Claude Code に引き継ぐための指示書。
shikumika 側で新しいセッションを開始する際、最初にこの内容を伝えること。

---

## shikumika 側に伝える指示（これをコピペする）

```
以下の企画書に基づいて、shikumika の AI 基盤をリニューアルしたい。
まず MAP.md を読んで現状を把握した上で、この企画内容を反映した仕様書を作成してほしい。

## 背景
- 現在の AI（Gemini 2.5-flash）ではエージェント的な動きが弱い
- カレンダー追加やマインドマップ更新がまともに動かない
- 壁打ちチャットするだけで計画書・マインドマップ・スケジュールが自動で出来上がる体験を目指す

## やりたいこと: AI基盤のモデル非依存化 + スキル連動自動切替

### 1. AIProvider 抽象レイヤーの実装
特定のAIプロバイダーに依存しない共通インターフェースを作る。

interface AIProvider {
  chat(messages: Message[], tools: Tool[]): Promise<Response>
}

OpenAI / Anthropic / Google を差し替え可能にする。

### 2. スキルごとにAIモデルを自動切替
スキルの種類に応じて、最適なモデルを自動選択する。

const SKILL_MODEL_MAP = {
  'calendar':      { provider: 'openai',    model: 'gpt-4o-mini' },
  'task-add':      { provider: 'openai',    model: 'gpt-4o-mini' },
  'habit':         { provider: 'openai',    model: 'gpt-4o-mini' },
  'mindmap':       { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'brainstorm':    { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'research':      { provider: 'openai',    model: 'gpt-4o' },
  'analysis':      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
}

### 3. 2段階ルーティング
Stage 1: ルーター（GPT-4o-mini）がユーザーの発言を分析し、どのスキルに該当するか判定
Stage 2: スキルに紐づくモデルに自動ルーティング
  - 軽いスキル（カレンダー、タスク追加）→ GPT-4o-mini がそのまま処理
  - 重いスキル（壁打ち、構造化、設計）→ Claude Sonnet / GPT-4o に引き継ぎ

### 4. 壁打ち対話の強化
- 深掘り質問ができるプロンプト設計
- ユーザーコンテキストの活用強化（ai_context_documents, ai_user_context）
- 対話しながら自動でマインドマップノードを生成・更新

### 5. スキルシステムのUI（将来）
- アイコン付きパッケージとして設定画面で管理
- ON/OFF トグルでインストール/アンインストール
- 各スキルに必要な外部連携の認証フロー

## 実装の優先順位
Step 1: AIProvider 抽象レイヤー + モデル切替テーブル
Step 2: 壁打ち対話の品質向上（プロンプト設計）
Step 3: 対話→マインドマップ自動変換の改善
Step 4: スキルUIのパッケージ化
Step 5: 外部連携スキルの拡充

## コスト目標
- 月額 ¥980 プランで粗利率 75-90%
- 軽い処理は GPT-4o-mini（$0.15/$0.60 per 1M tokens）
- 深い処理は Claude Sonnet / GPT-4o

## 注意事項
- 既存の機能（マインドマップ、カレンダー連携、習慣トラッキング）は壊さない
- 段階的に移行する。一気に全部変えない
- まず /start で現状を確認してから、仕様書を docs/specs/ に作成してほしい
```

---

## 使い方
1. VSCode で `/Users/kitamuranaohiro/Private/P dev/shikumika-app` を開く
2. Claude Code を起動する
3. 上の ``` で囲まれた部分をコピペして送信する
4. shikumika 側の Claude が MAP.md を読み、仕様書を作成してくれる

## 企画書の原本
詳細な企画書はここにある（必要に応じて参照）:
/Users/kitamuranaohiro/Private/人生管理/outputs/shikumika/concept-ai-core.md
