---
fix: Google Calendar OAuth 認証失敗
type: fix
created: 2026-02-07
status: resolved
---

# 修正計画: Google Calendar OAuth 認証が取得できない

## エラー内容
- エラーメッセージ: `Google OAuth tokens not found` (画面上に表示)
- 発生箇所: `src/lib/google-calendar.ts:30-33` (getCalendarClient 関数)
- 再現手順:
  1. アプリにログイン
  2. カレンダー連携ボタンをクリック
  3. Google 認証後、トークンが保存されない

## 原因分析
- **主原因**: Google Cloud Console のリダイレクドURI が変更されたのに、設定が更新されていない
  - ローカル開発: `http://localhost:3001/api/calendar/callback` に変更
  - Netlify 本番: `https://shikumika.netlify.app/api/calendar/callback` を新規登録

- **副原因**: `.env.local` と Netlify 環境変数に `GOOGLE_REDIRECT_URI` が正しく設定されていない

## 影響範囲
- `src/lib/google-calendar.ts` - トークン管理
- `src/app/api/calendar/connect/route.ts` - OAuth フロー開始
- `src/app/api/calendar/callback/route.ts` - トークン取得・保存
- 環境変数: `.env.local`, Netlify 設定

## 修正方針

### 1. Google Cloud Console での登録URI更新
- 既存の登録URI を確認・削除（古い Vercel URL）
- 新しいリダイレクドURI を登録：
  - `http://localhost:3001/api/calendar/callback` (ローカル)
  - `https://shikumika.netlify.app/api/calendar/callback` (本番)

### 2. ローカル環境変数の設定
- `.env.local` に正しい環境変数を追加

### 3. Netlify 環境変数の設定
- Netlify ダッシュボードで環境変数を設定

### 4. コード側の確認
- `/api/calendar/callback` でエラーハンドリングを確認
- トークン保存ロジックが正しく動作しているか確認

## 修正対象ファイル
- `.env.local` - 環境変数設定
- (Netlify ダッシュボード - 本番環境変数)
- `src/app/api/calendar/callback/route.ts` - エラーログ追加（必要に応じて）

## 作業内容
1. ✅ 修正計画書の作成
2. ✅ Google Cloud Console での登録URI設定（ユーザー実施）
3. ✅ `.env.local` の更新
4. ✅ Netlify 環境変数の設定（ユーザー実施）
5. ✅ コード修正（エラーログ追加）
6. ✅ GitHub コミット・プッシュ
7. ⏳ Netlify でのテスト実行

## 修正内容
- エラーハンドリングを強化（OAuth2 設定・トークン情報の詳細ログ）
- Google Calendar API リダイレクドURI をローカル・本番で正確に設定
- スコープ確認完了（`calendar.events` - 読み書き両対応）
