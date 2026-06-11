---
status: active
category: feature
priority: high
created: 2026-05-30
updated: 2026-05-30
related: [mindmap-node-codex-relay.md]
---

# LP 全面差し替え計画（複数AIオーケストレーター / Mac個人パワーユーザー向け）

## 概要

現状LP（`src/app/page.tsx`）は旧ポジショニング「AI業務自動化プラットフォーム（B2SMB / seat課金 / API再販）」のまま。
新背骨「**思考をマインドマップで可視化し、あなたが選んだAIサブスク（Codex/Claude/Gemini）をオーケストレーションする中間管理職アプリ**」と**真逆**のため、微修正ではなく**設計から差し替える**。
売れているMac/AIパワーユーザー系プロダクトのLP型に寄せ、Xでのデモ動画ドリブン拡散に最適化する。

## 現状LPの問題（差し替え理由）

- 見出し「AI業務自動化プラットフォーム / あなたのMacで動く、AI業務自動化」＝旧B2SMB。
- **料金欄が新モデルと矛盾**：「月額にAI実行コストが含まれます（Gemini Flash-Lite / DeepSeek 激安モデル採用）」
  ＝**APIを再販する旧モデル**。新方針「API再販ゼロ・ユーザー自身のCodex/Claudeサブスクで実行」と正面衝突。**要全削除**。
- seat課金 / SSO・SAML / 監査ログ / enterprise / BYOK＝B2SMBの名残。個人パワーユーザー一発目には不要 → 撤去 or 後回し。
- ヒーローに**製品デモが無い**（テキストのみ）。2026の勝ち筋（3〜5秒で価値を見せる story-driven hero）に反する。
- ソーシャルプルーフ無し。
- **保持必須**: Google Calendar OAuth 開示ブロック（`calendar.events` / `calendar.calendarlist.readonly` の説明）。
  **OAuth verification 申請中**のため、審査で参照される可能性。文言は残す（位置は変えてよい）。

## 参照型（売れているLPのteardown）

> 一次情報の見出し・構成と2026ベストプラクティスから抽出。出典は本書末尾。

| 参照 | 効いている要素 | FocusMapへの転用 |
|---|---|---|
| **Cursor**「The best coding agent」 | 超短い便益見出し＋巨大な製品デモ動画をヒーローに | ヒーロー＝タグライン＋デモ動画（往復実行の絵） |
| **Raycast**「Your shortcut to everything」 | ダーク&上質・イラスト/製品ショット・速さの世界観 | ダーク基調・キーボード/ターミナル質感でパワーユーザー訴求 |
| **Linear** | ミニマル/プレミアム・精緻な製品スクショ・"速い"の体感 | 余白とプロダクト画像主役・thin chrome |
| **Granola**（#292929 + 差し色 #b2c147 / Next+Tailwind） | 単一ユースケースの明快さ・役割別の使い方 | 「考え→自分のAIが実行」の単一物語に絞る |
| **2026 共通則** | 5〜8セクション / 見出し<44字 / above-fold に価値の可視化 / hero直下にソーシャルプルーフ / 単一CTAを反復 / 透明な料金 / FAQ | 下記セクション構成に反映 |

## 新LP セクション構成（上から）

1. **ヒーロー（split-screen: 左コピー / 右デモ）**
   - 見出し（<44字・タグラインA）: 「**考えを描けば、あなたのAIが動く。**」
   - サブ: 「マインドマップから、あなたが課金しているCodex / Claude にプロンプトを注入。ローカルで実行し、往復しながら片付ける。」
   - 主CTA: 「**無料で始める**」（副: 「30秒デモを見る」）
   - 右: **ヒーローデモ動画/GIF**（mindmap-node-codex-relay の絵コンテ: ノード→実行→ログ往復→カレンダー/進捗が埋まる）
2. **ソーシャルプルーフ帯**（誇張しない。初期は「X で公開中」「作者の実運用」/ デモGIF / 将来 利用者の声）
3. **マジック説明**（製品ビジュアル＋短文）: マインドマップ＝司令塔。ノード＝仕事の単位（待機/実行中/要返信/完了）
4. **ユニットエコノミクスの楔**: 「**API再販ゼロ。あなたが払っているAIで実行する。**」従量課金の青天井が無い
5. **ローカル実行＝安全**: 自分のログイン/Cookieで動く。認証情報は手元のMacから出ない（OAuth開示ブロックはここ or フッターに）
6. **中間管理職（往復・ログ監視）**: 会話ログを監視、こちらから再注入、プロジェクト進捗を差配
7. **複数AI対応**: Codex / Claude / Gemini…「あなたが選んだAIで動く」（OpenAI依存リスクを"機能"に転換）
8. **使い方 3ステップ**: ①AIを繋ぐ ②考えを描く ③ノードから実行
9. **差別化**: vs Zapier/Lindy（従量課金の青天井が無い）/ vs ChatGPT（行動まで繋がる）
10. **料金（全面書き換え）**: **定額フラットSaaS / 従量課金なし**。無料枠はノード数・プロジェクト数で制限（実行回数では絞らない）。seat/SSO/監査ログ/enterprise は撤去 or 「Teamは後日」表記
11. **FAQ**: Macは必須？ / どのAIサブスクが要る？ / データはどこ？ / Codexが落ちたら？（複数AI対応で回答）
12. **最終CTA**: タグラインB「API再販ゼロ。あなたのサブスクで実行。」＋CTA反復
13. **フッター**: ログイン / プライバシー / 利用規約 / 問い合わせ / OAuth開示（保持）

## デザイン方針

- **ダーク基調・上質・ミニマル**（Raycast/Linear系）。製品ビジュアル主役、chrome薄め。
- **キーボード/ターミナル質感**のアクセント（パワーユーザーの世界観）。等幅フォントを差し色的に。
- マイクロアニメーション（ノードの状態遷移、ログが流れる）。
- 既存Tailwind/Radix・`bg-background`/`text-foreground` トークンを踏襲しつつ、ヒーローだけ専用スタイル。

## 実装対象ファイル（重要）

- [ ] 変更: `src/app/page.tsx`（セクション分割・コピー差し替え・料金書き換え・metadata更新）
- [ ] 作成: `src/components/landing/`（Hero / SocialProof / FeatureRow / HowItWorks / Comparison / Pricing / FAQ / FinalCta）
- [ ] 変更: `src/lib/plans.ts`（フラット定額へ。seat/exec課金・enterprise系の撤去 or 整理）
- [ ] 資産: ヒーローデモ動画/GIF（`public/` 配下。製品UIがデモ可能になってから or モックで先行）

## 実装フェーズ

### Phase 1: 構成と骨組み
- [ ] page.tsx をセクションコンポーネントに分解（中身は仮コピー）
- [ ] ダーク/上質のデザイントークン確定、ヒーロー split-screen レイアウト

### Phase 2: コピー差し替え（新ポジショニング）
- [ ] 全セクションの日本語コピーを確定（タグラインA/B・楔・3ステップ・差別化・FAQ）
- [ ] metadata（title/description）を新ポジショニングへ

### Phase 3: 料金の全面書き換え
- [ ] `plans.ts` をフラット定額に。矛盾文言（API実行コスト込み/激安モデル/従量）削除
- [ ] 無料枠＝ノード/プロジェクト数制限で再設計

### Phase 4: ビジュアル
- [ ] ヒーローデモ（まずモック/GIF、後で実画面キャプチャに差し替え）
- [ ] 製品スクショ、マイクロアニメーション

### Phase 5: 仕上げ・整合
- [ ] OAuth開示ブロックの保持確認（審査影響ゼロ）
- [ ] レスポンシブ（スマホ）/ ライトハウス速度 / 単一CTA反復の確認

## 完了条件

- [ ] 3〜5秒で「自分のAIがマインドマップから実行される」が伝わるヒーロー（デモ可視）
- [ ] 料金が定額フラットで、旧API再販文言がゼロ
- [ ] B2SMB名残（seat/SSO/監査/enterprise）が主導線から消えている
- [ ] OAuth開示が残り審査に影響しない
- [ ] スマホで崩れない・主CTAが各セクションで一貫

## 未確定 / 要決定

- ヒーローデモの作り方（実画面キャプチャ vs モックアニメ）。製品UIのデモ準備度に依存。
- 料金の具体額（フラット月額の価格点・無料枠の境界）。
- ソーシャルプルーフの初期素材（誇張しない範囲で何を出すか）。
- Team を「後日」と明記するか、完全に出さないか。

## 参照（出典）

- 2026 SaaS LP ベストプラクティス: saashero.net / fibr.ai / swipepages.com / vezadigital.com
- Cursor: https://cursor.com/ （"The best coding agent" 超短見出し＋デモ）
- Raycast: https://www.raycast.com/ ・teardown https://www.lapa.ninja/post/raycast-4/
- Granola: https://saaslandingpage.com/granola/ （#292929/#b2c147, Next+Tailwind）
- Unbounce 2026 例集: https://unbounce.com/landing-page-examples/best-landing-page-examples/
