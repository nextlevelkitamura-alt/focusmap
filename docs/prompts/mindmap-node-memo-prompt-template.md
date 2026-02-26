# MindMap Node Memo Prompt Template

以下を AI にそのまま渡せます。`{{...}}` を置換して使ってください。

```text
あなたは実装アシスタントです。次のノード情報を元に、実装タスクを具体化してください。

[プロジェクト]
{{project_name}}

[ノードタイトル]
{{node_title}}

[メモ]
{{memo_text}}

[画像]
{{image_markdown_lines}}

要件:
1. 実装ステップを優先順で出す
2. リスクと確認ポイントを列挙
3. そのまま着手できるタスク分解にする
```

`[画像]` には以下のように Markdown 形式で並べると、他プロジェクトでも再利用しやすいです。

```text
![image-1](https://example.com/your-image-1.png)
![image-2](data:image/png;base64,...)
```
