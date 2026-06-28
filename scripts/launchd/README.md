# launchd 再インストール

Focusmap repoを移動した後でも、現在のrepo位置に合わせてlaunchd設定を作り直すための入口。

## 確認だけ

```bash
bash scripts/launchd/install.sh --dry-run
bash scripts/launchd/status.sh
```

## Codex app-serverだけ再インストール

```bash
bash scripts/launchd/install.sh core
```

対象:

- `com.focusmap.codex-app-server`

## repo内の全plistを再インストール

```bash
bash scripts/launchd/install.sh all
```

対象:

- `com.focusmap.codex-app-server`
- `com.focusmap.task-runner`

## 停止

```bash
bash scripts/launchd/install.sh --unload core
```

`core` はCodex app-serverだけ、`all` はrepo内のFocusmap launchdを対象にする。
