# 競合分析 — 自動化SaaS 5社比較

> 調査日: 2026-05-26
> 親計画: [focusmap-saas-pivot.md](./focusmap-saas-pivot.md)
> 目的: 論点a (BUYER/USER分離設計) に入る前に、競合の管理画面・課金構造を把握し、「組み合わせ優位性」仮説を早期検証する

---

## 1. 5社 価格・課金単位 比較表

| 競合 | 最低有料 | チーム | エンタープライズ | 課金単位 | フリー枠 | 自社ホスト |
|---|---|---|---|---|---|---|
| **Zapier** | $19.99/月 (Pro) | $69/月 (25users) | Custom | Tasks (成功アクション) | 100 tasks/月 | × |
| **Lindy** | $49.99/月 (Plus) | — (個人プランのみ) | Custom | "Usage allowance" (曖昧) | **なし** (7日trial) | × |
| **Bardeen** | $10/月 (Basic) | — (明示なし) | Custom (年契約) | Credits (アクション種別で消費) | 100 credits/月 | × |
| **n8n** | €20/月 (Starter) | €50/月 (Pro) / €667/月 (Business) | Custom | Workflow executions (1実行=1) | OSS自社ホスト無料 / Trial | **○ (OSS Community Edition)** |
| **Make** | $9/月 (Core) | $29/月 (Teams) | Custom | Credits (1モジュールアクション=1) | 1,000 credits + 2 scenarios | × |

### 価格帯マッピング

```
$9 ────── $10 ── $16 ── $19.99 ── $29 ── $49.99 ── $69 ────── Custom
 Make     Bardeen Make   Zapier    Make   Lindy     Zapier    Enterprise
 Core     Basic   Pro    Pro       Teams  Plus      Team
                                                              (n8n Business €667
                                                               = 約$720は突出)
```

**観察:**
- **個人向け最安値帯**: $9〜$20 が市場標準 (Make/Bardeen/Zapier)
- **AI特化系 (Lindy)** は $49.99 から = AI実行コストを織り込んだ高め設定
- **チーム機能** は $29 (Make Teams) 〜 $69 (Zapier Team) でジャンプ
- **Bardeen は Basic $10 が低すぎる印象** — クレジット制で実質課金が積み上がる構造

---

## 2. BUYER/USER 分離機能の有無

| 機能 | Zapier | Lindy | Bardeen | n8n | Make |
|---|---|---|---|---|---|
| マルチユーザー | Team $69〜 | Enterpriseのみ | 不明 | 全プラン (Unlimited) | Teams $29〜 |
| Admin Roles (RBAC) | Team $69〜 | Enterpriseのみ | 不明 | **Pro €50〜** | Teams $29〜 |
| SSO/SAML | Team $69〜 | Enterpriseのみ | 不明 | Business €667〜 | Enterpriseのみ |
| Audit Logs | Enterprise | Enterprise | 不明 | Business €667〜 | Teams $29〜 |
| 共有プロジェクト/Folder | Team $69〜 | × | 不明 | 全プラン (数で制限) | Teams $29〜 |
| 利用状況Analytics | Enterprise | × | 不明 | Pro €50〜 | Teams $29〜 |

**重要発見:**
- **「BUYER (決裁者) 向け管理画面」が低価格帯にあるのは Make Teams ($29) と n8n Pro (€50) だけ**
- それ以外は管理画面=エンタープライズ (Custom価格) でガード
- **= 中小企業 (5〜30人) 向け、Mac mini導入レベルの「軽量管理画面」は明らかな空白**

---

## 3. 「ローカル実行」軸での競合状況

| 競合 | 実行場所 | 認証データの保存先 | ブラウザ自動化 |
|---|---|---|---|
| Zapier | クラウド | Zapier側 | × (Web Hooksのみ) |
| Lindy | クラウド | Lindy側 | ○ (Computer Use, クラウドVMで) |
| Bardeen | ローカル (ブラウザ拡張) | ブラウザ内 | ○ (拡張機能で操作) |
| n8n (Cloud) | クラウド | n8n側 | × |
| n8n (OSS Self-host) | 自社サーバ | 自社 | △ (Playwrightノード可) |
| Make | クラウド | Make側 | × |

**ローカル実行軸の地図:**

```
                          ローカル実行
                              ↑
                              |
        Bardeen (拡張)   Focusmap候補 (Mac mini + Webアプリ)
                              |
                              |    n8n OSS (技術者必須)
                              |
                              ↓
                          クラウド実行
                       Zapier / Lindy / Make
```

**Focusmapが狙える空白:**
- **Bardeen** は近いがブラウザ拡張に閉じる (ブラウザ外操作不可、PC起動中常駐不可)
- **n8n OSS** は技術者向け (Docker/サーバ知識必須)
- **「Mac mini常時稼働 + Webアプリ管理 + 非エンジニア社員でも使える」は構造的に空白**

---

## 4. フリー枠とAPI暴走対策の参考値

| 競合 | フリー枠 | 暴走防止 |
|---|---|---|
| Zapier | 100 tasks/月 + 2-step Zapsのみ | Tasks超過時に自動pay-per-task切替 (1.25x) |
| Lindy | なし (7日trial) | "Usage allowance" 上限 |
| Bardeen | 100 credits/月 + Basic ($10)必須 | Credits上限 |
| n8n | OSS無料 (自社ホスト) | Workflow executions上限 |
| Make | 1,000 credits + 2 scenarios + 15分間隔制限 | Credits上限 + 実行頻度制限 |

**Focusmapで採用すべき暴走対策:**
- **実行回数上限** (Zapier型) または **クレジット上限** (Make/Bardeen型)
- **--max-budget-usd** をAPI呼び出し全てに強制 (Focusmap独自)
- **実行頻度の最小間隔** (Make型: 15分間隔)
- **フリー枠は厳しめ**: 5〜10実行/月 or 100 credits程度 (= 「自動化1個試せる」レベル)

---

## 5. Focusmapが取れるポジショニング (仮説)

### 5.1 ポジショニングステートメント (案)

> **「Mac mini常時稼働 + Webアプリ管理画面」で、ローカル実行の安心感とSaaSの使いやすさを両立する、中小企業向けAI自動化プラットフォーム**

### 5.2 競合に対する立ち位置

| 軸 | Focusmap | 競合との差 |
|---|---|---|
| 実行場所 | ローカル (Mac mini) | Zapier/Lindy/Makeはクラウド。Bardeenは拡張機能のみ。n8n OSSは技術者必須 |
| 認証データ | 自社ローカル (Cookie/OAuth は自分のPC) | クラウド系は全部Vendor側 → セキュリティ意識高い層に刺さる |
| セットアップ | Webアプリ + ボタン1つでローカルエージェント導入 | n8n OSSはDockerフル理解が必須、Bardeenは拡張インストール |
| 管理画面 | 低価格 ($29〜?) でAdmin/RBAC/Audit | Zapier Team $69、Lindy Enterpriseのみ。Makeに近い水準 |
| AIスケジュール可視化 | 強み (既存Focusmap機能) | Lindyに次ぐ、他は弱い |

### 5.3 価格設定の試算

| プラン | 価格 (案) | 内容 |
|---|---|---|
| Free | $0 | 5実行/月、1スキル、Mac mini不要 (試用のみ) |
| Personal | **$19/月** | 100実行/月、無制限スキル、Mac mini連携、月額にAPIコスト込み |
| Team | **$39/月/seat** (最低3seat) | 共有スキル、管理画面、利用Analytics、Audit Log |
| Enterprise | Custom | SSO/SAML、専任サポート、BYOK選択可 |

**収益試算 (年間):**
- Personal 100人 × $19 × 12 = **$22,800 (約350万円)**
- Team 30社 × 5seat × $39 × 12 = **$70,200 (約1,050万円)**
- 合計約1,400万円 ← 個人開発として「食える」最低ライン突破

**Personal 1,000人 + Team 100社規模なら年5,000万円〜** 。これは現実的に1〜2年スパンの目標。

---

## 6. 「組み合わせ優位性」仮説の検証結果

grill-meセッションで指摘した「組み合わせ優位性は専業ツールに各軸で負ける」 → **競合調査の結果、修正された結論:**

### 検証された強み

1. **「ローカル実行 + 軽量管理画面 + 非エンジニア向けUX」の3つを同時に持つ競合は存在しない**
   - Bardeenはローカルだが管理画面なし
   - n8n OSSはローカル+管理画面あるが技術者向け
   - Zapier/Lindy/Makeはクラウド
   - → **空白あり、組み合わせ優位性は仮説段階だが成立可能性あり**

2. **管理画面の軽量帯 ($29-50)** は Make Teams と n8n Pro しか埋めていない
   - そこに「ローカル実行・Mac mini」を加える形なら差別化成立

### 残るリスク

1. **Mac mini投資 (約8万円) の心理的障壁** が大きい
   - 競合は全部「ブラウザだけで使える」
   - これに勝つロジック: 「データは自社にある」セキュリティ訴求、しかし中小企業ではここまで意識されないかも
2. **n8n が将来「ローカル実行 + Webアプリ管理画面」に進出するリスク**
   - OSSコミュニティの規模 (189K stars) を考えると、彼らが本気を出したら一瞬で潰される
   - → **早期にユーザー確保 + 業界知識で防衛壁を作る必要**
3. **「ローカル実行」のメリットがエンドユーザーに伝わりにくい**
   - 「クラウドの方が手軽じゃない?」 がデフォルトの心理
   - マーケティングで「データ主権」「自分のCookie」を訴求できるか

---

## 7. 次のアクションへの示唆

論点a (BUYER/USER分離設計) を詰める時の参考:

1. **管理画面のスコープ**: Make Teams レベル (Audit Log / Roles / Analytics) を最低ラインに置く
2. **課金単位の選定**: 「Workflow executions」(n8n型) が最もユーザーフレンドリー (ステップ数気にせず使える)
3. **価格レンジ**: Personal $19、Team $39/seat が市場相場との整合性で妥当
4. **フリー枠**: 5実行/月 + 1スキル + Mac mini不要の試用モードを用意 (= 「自動化1個」だけ味見できる)
5. **暴走対策**: 上限制 + 最小実行間隔 + --max-budget-usd強制 の3層構造

---

## 8. 検証が必要な仮説 (今後のユーザーインタビュー項目)

- [ ] 「Mac mini約8万円投資」を中小企業の決裁者が受け入れるか
- [ ] 「ローカル実行=データ流出しない」が刺さる業界はどこか (士業? 医療? 金融? 人材?)
- [ ] 「ブラウザだけで使える」競合より高い価値を感じてもらえる訴求は何か
- [ ] Personal $19 / Team $39 の価格感は妥当か (もっと高く取れるか)
- [ ] 「AIに不慣れな社員」が実際に使えるUXはどこまで簡素化が必要か

---

最終更新: 2026-05-26
