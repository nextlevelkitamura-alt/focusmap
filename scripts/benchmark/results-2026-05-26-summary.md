# Mini Benchmark Results (2026-05-26)

> 自動生成: scripts/benchmark/mini.ts による測定結果
> 親計画: [benchmark-procedure.md](../../docs/plans/benchmark-procedure.md)

## 集計

| Model | Task | 成功率 | JSON有効率 | キー充足率 | 平均トークン (入/出) | 平均コスト | 平均レイテンシ |
|---|---|---|---|---|---|---|---|
| gemini-2.5-flash | web-summary | 33% | 33% | 33% | 109 / 130 | $0.00005 | 4.5s |
| gemini-2.5-flash | email-classify | 67% | 67% | 67% | 320 / 283 | $0.00011 | 9.5s |
| gemini-2.5-flash | calendar-suggest | 33% | 33% | 33% | 115 / 167 | $0.00006 | 15.7s |
| gemini-2.5-flash-lite | web-summary | 100% | 100% | 100% | 328 / 396 | $0.00007 | 2.5s |
| gemini-2.5-flash-lite | email-classify | 100% | 100% | 100% | 480 / 421 | $0.00008 | 3.0s |
| gemini-2.5-flash-lite | calendar-suggest | 100% | 100% | 100% | 344 / 407 | $0.00007 | 2.8s |
| groq-llama-3.3-70b | web-summary | 67% | 67% | 67% | 245 / 189 | $0.00029 | 0.6s |
| groq-llama-3.3-70b | email-classify | 33% | 33% | 33% | 188 / 118 | $0.00020 | 0.5s |
| groq-llama-3.3-70b | calendar-suggest | 67% | 67% | 67% | 252 / 257 | $0.00035 | 0.7s |

## モデル別 総合

| Model | 試行 | 完全成功率 | 平均コスト/実行 | 月100実行原価 (Personal $19想定) | 月2,500実行原価 (Team $195想定) |
|---|---|---|---|---|---|
| gemini-2.5-flash | 9 | 44% | $0.00007 | $0.01 | $0.18 |
| gemini-2.5-flash-lite | 9 | 100% | $0.00008 | $0.01 | $0.19 |
| groq-llama-3.3-70b | 9 | 56% | $0.00028 | $0.03 | $0.71 |

## 注意事項

- このベンチマークは **Browser automation のプロキシ**として固定HTML/メール/カレンダーをLLMに渡して構造化出力させたもの
- 実際のPlaywright実行では DOM操作の試行錯誤・リトライが入り、トークンが3〜5倍に膨らむ可能性
- benchmark-procedure.md のフル仕様 (Playwright + 4スキル × 4モデル × 10回 = 160実行) は北村本人が後日実施
- この結果は **「価格設計が現実的か」のフィージビリティチェック**として読む
