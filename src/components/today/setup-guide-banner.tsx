'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Terminal, Copy, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SetupStatus {
  claudeInstalled: boolean
  taskRunnerInstalled: boolean
  nodeInstalled: boolean
}

export function SetupGuideBanner() {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // sessionStorage でバナー非表示を記憶
    if (sessionStorage.getItem('setup-guide-dismissed')) {
      setDismissed(true)
      return
    }
    fetch('/api/ai-tasks/status')
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => {})
  }, [])

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('setup-guide-dismissed', '1')
  }

  // 全て完了 or 読み込み中 or 非表示
  if (!status || dismissed) return null
  if (status.claudeInstalled && status.taskRunnerInstalled) return null

  const steps: { label: string; done: boolean; cmd?: string; description: string; link?: string }[] = []

  if (!status.claudeInstalled) {
    steps.push({
      label: 'Claude Code をインストール',
      done: false,
      cmd: 'npm install -g @anthropic-ai/claude-code',
      description: 'AIスキルの自動実行に必要です。インストール後、ターミナルで claude と打つとログイン画面が開きます。',
      link: 'https://claude.ai/code',
    })
  }

  if (!status.taskRunnerInstalled) {
    steps.push({
      label: 'スケジュール実行を有効化',
      done: false,
      cmd: 'bash scripts/setup.sh',
      description: '定期タスクをバックグラウンドで自動実行するための設定です。',
    })
  }

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      {/* ヘッダー */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300 flex-1">
          AIスケジュール実行のセットアップが必要です
        </span>
        <span className="text-xs text-amber-600/60 dark:text-amber-400/60 mr-1">
          {steps.length}ステップ
        </span>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-amber-500/60" />
          : <ChevronDown className="w-4 h-4 text-amber-500/60" />
        }
      </button>

      {/* 展開時のガイド */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-amber-200/50 dark:border-amber-800/50 pt-3">
          <p className="text-xs text-muted-foreground">
            ターミナル（Mac の場合: Spotlight で「ターミナル」と検索）を開いて、以下のコマンドを順番に実行してください。
          </p>

          {steps.map((step, i) => (
            <div key={i} className="rounded-lg bg-background/80 border border-border/40 p-3">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>

                  {step.cmd && (
                    <div className="mt-2 flex items-center gap-2 bg-muted/60 rounded-md px-3 py-2">
                      <Terminal className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      <code className="text-xs font-mono flex-1 text-foreground">{step.cmd}</code>
                      <button
                        onClick={() => handleCopy(step.cmd!)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground transition-colors"
                        aria-label="コピー"
                      >
                        {copiedCmd === step.cmd
                          ? <Check className="w-3.5 h-3.5 text-green-500" />
                          : <Copy className="w-3.5 h-3.5" />
                        }
                      </button>
                    </div>
                  )}

                  {step.link && (
                    <a
                      href={step.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
                    >
                      詳しくはこちら
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            このセッションでは表示しない
          </button>
        </div>
      )}
    </div>
  )
}
