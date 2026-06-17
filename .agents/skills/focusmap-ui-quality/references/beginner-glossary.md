# Beginner Glossary

Use these plain meanings when explaining the workflow.

- Design Pack: 実装前に作る設計セット。現状評価、改善案、UI受け入れ条件、必要なら見えるモックアップ画像を含む。
- UI acceptance: 実装が合格かどうかを判断する条件。見た目、操作、スマホ/PC差、エラー、保存中状態などを含む。
- Mockup: 実装前に見るUI画像。画像生成プロンプトだけではなく、実際に見える画像ファイルを指す。
- Worker: 分担された実装担当チャット。触ってよいファイルと触ってはいけないファイルが決まっている。
- Foundation Worker: 共通の土台を作るworker。shell、共通部品、primitives、ナビなどを先に作る。
- Detail Worker: 個別画面を作るworker。Foundationのファイルは編集せず、使うだけにする。
- Integration: workerの結果を集めて、競合やズレを直し、local mainへ入れる担当。
- Gate: 次へ進んでよいかの関門。例えば、見た目を変える実装は、ユーザーがモックアップを確認してから進める。
- P0: すぐ直すべき致命問題。白画面、例外、操作不能、データ損失リスクなど。
- P1: 完了扱いにしない重要問題。PC/スマホで別アプリに見える、主操作が分かりにくい、保存状態が分からないなど。
- no-image exception: 本来はモックアップ画像が必要だが、ユーザーが画像なしで進めると明示承認した状態。

## Beginner Rule

迷ったら次だけ守る。

1. 壊れているなら `fast-triage`。
2. 大きく変えるなら `ui-runbook`。
3. Chat 1とChat 2を同時に送らない。
4. 実装workerは、Chat 2が出したプロンプトだけを使う。
5. worker結果は全部そろえてからChat 2へ戻す。
6. push/deployは最後に別で承認する。
