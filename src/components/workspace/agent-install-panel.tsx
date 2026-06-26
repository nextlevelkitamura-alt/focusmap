'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, Terminal, ExternalLink } from 'lucide-react';

interface AgentInstallPanelProps {
  spaceId: string;
}

export function AgentInstallPanel({ spaceId }: AgentInstallPanelProps) {
  const [copied, setCopied] = useState(false);
  const [command, setCommand] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateCommand = async () => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/agents/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_id: spaceId, name: 'Focusmap Agent' }),
      });
      const data = await response.json().catch(() => ({})) as { install_command?: string; error?: string };
      if (!response.ok || !data.install_command) {
        throw new Error(data.error || `トークン発行に失敗しました (${response.status})`);
      }
      setCommand(data.install_command);
      return data.install_command;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'インストールコマンドを生成できませんでした';
      setError(message);
      throw err;
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    const installCommand = command || await generateCommand();
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="h-4 w-4" />
          Mac mini にエージェントを導入
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          常時起動しておくMac (推奨: Mac mini) のターミナルで以下のコマンドを実行してください。
          Node.js / Playwright / launchd設定 が自動で行われます。Codex Desktop/CLI が入っていればそのまま連携し、
          古いCLIの場合はアップデート案内を表示します。
        </p>

        <div className="relative">
          <pre className="overflow-x-auto rounded-md border border-border/40 bg-muted/60 px-3 py-2.5 text-xs font-mono">
            {command || 'クリックでインストールコマンドを生成します'}
          </pre>
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-1 top-1 h-7 w-7"
            onClick={handleCopy}
            disabled={generating}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium hover:text-foreground">
            ターミナルの開き方
          </summary>
          <ol className="mt-2 space-y-1 pl-4">
            <li>1. ⌘ + Space で Spotlight を開く</li>
            <li>2. 「ターミナル」と入力 → Enter</li>
            <li>3. 上のコマンドを貼り付けて Enter</li>
            <li>4. 完了画面が出るまで5-10分待つ</li>
          </ol>
        </details>

        <div className="flex flex-wrap gap-2 text-xs">
          <a
            href="https://focusmap-official.com/docs/agent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> 詳細ドキュメント
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
