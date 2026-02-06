# ワークフロー

このプロジェクトでは以下のコマンドを使用して開発を進めます。

## コマンド一覧

| コマンド | 説明 | 使用タイミング |
|----------|------|----------------|
| `/setup` | プロジェクトをセットアップ | 新しいプロジェクトを始める時 |
| `/d` | 実装計画を作成 | 新しい機能を追加する前 |
| `/tdd` | TDDで実装 | 計画に基づいて実装する時 |
| `/status` | 進捗を確認 | 現在の状況を把握したい時 |
| `/archive` | 完了プランをアーカイブ | 実装が完了した時 |
| `/handoff` | Gemini からの引継ぎメモを作成 | Gemini から Claude Code に引き継ぐ時 |

## 開発フロー

### 基本フロー

```
/setup → プロジェクトをセットアップ（初回のみ）
     ↓
/d (plan) → 計画を立てる
     ↓
/tdd (impl) → TDDで実装
     ↓
/archive → 完了したプランを整理
```

### Gemini 3.0 との連携

```
Gemini 3.0 (UI計画・実装)
     ↓
/handoff → 引継ぎメモを作成
     ↓
/status → 引継ぎ状況を確認
     ↓
/d (plan) → Claude Code で実装計画
     ↓
/tdd (impl) → Claude Code で実装
```

### 引継ぎのタイミング

- **Gemini → Claude Code**: UI計画・実装が完了したら `/handoff` を実行
- **Claude Code → Gemini**: 実装が完了したら `/handoff` でレビューを依頼

## プランのステータス

| ステータス | 場所 | 説明 |
|----------|------|------|
| `active` | `docs/plans/active/` | 現在進行中のプラン |
| `gemini` | `docs/plans/gemini/` | Gemini が担当中のUI計画・実装 |
| `completed` | `docs/plans/completed/` | 完了したプラン（要約済み） |
| `archive` | `docs/plans/archive/` | 長期保存用のアーカイブ |

## 引継ぎの管理

| 種類 | 場所 | 説明 |
|------|------|------|
| `Gemini → Claude` | `docs/handoff/gemini-to-claude.md` | Gemini からの引継ぎメモ |
| `Claude → Gemini` | `docs/handoff/claude-to-gemini.md` | Claude からの引継ぎメモ |

## ファイル命名規則

プランファイルは以下の形式で命名してください：
```
YYYYMMDD-{category}-{short_title}.md
```

例:
- `20250205-feature-auth.md`
- `20250205-bugfix-login-error.md`
- `20250205-refactor-api-calls.md`
