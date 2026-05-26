'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Sparkles, Activity, Check, X } from 'lucide-react';
import { ChatMessage } from './chat-message';
import { SkillSuggestion } from './skill-suggestion';
import { TaskResultCard } from './task-result-card';
import { AutomationStatusPanel } from './automation-status-panel';
import type { IntentResult } from '@/lib/ai/intent-classifier';

interface PingResult {
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  response_preview?: string;
  error?: string;
}

interface AutoChatViewProps {
  spaceId: string | null;
  showStatusPanel?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: IntentResult;
  modelLabel?: string;
  taskId?: string;
  timestamp: string;
}

const SAMPLE_PROMPTS = [
  '今日のカレンダー整理して',
  'Zapier の価格を確認して要約して',
  '未読メールを3行で要約して',
];

export function AutoChatView({ spaceId, showStatusPanel = true }: AutoChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [pinging, setPinging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handlePing = async () => {
    setPinging(true);
    try {
      const res = await fetch('/api/chat/ping');
      const data = (await res.json()) as PingResult;
      setPing(data);
    } catch (e) {
      setPing({
        provider: 'unknown',
        model: 'unknown',
        ok: false,
        latency_ms: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPinging(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    const userMsg: Message = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, space_id: spaceId, auto_execute: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}-err`,
            role: 'system',
            content: `エラー: ${data?.error ?? '送信失敗'}`,
            timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}-ai`,
          role: 'assistant',
          content: data.intent.skill_id ? '解析しました' : '判定できませんでした',
          intent: data.intent,
          modelLabel: data.model_label,
          timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}-err`,
          role: 'system',
          content: `通信エラー: ${e instanceof Error ? e.message : 'unknown'}`,
          timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const executeIntent = async (messageId: string, intent: IntentResult) => {
    if (!intent.skill_id) return;
    setExecuting(messageId);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messages.find((m) => m.id === messageId)?.content ?? '',
          space_id: spaceId,
          auto_execute: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}-err`,
            role: 'system',
            content: `タスク投入失敗: ${data?.error ?? 'unknown'}`,
            timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}-task`,
          role: 'assistant',
          content: 'タスクを投入しました。 focusmap-agent が実行します。',
          taskId: data.task_id,
          timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          自動化チャット
        </h1>
        <div className="flex items-center gap-2">
          {ping && (
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                ping.ok
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              }`}
              title={ping.error ?? ping.response_preview}
            >
              {ping.ok ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
              {ping.model} ({ping.latency_ms}ms)
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePing}
            disabled={pinging}
            className="h-9 gap-1 text-[11px] md:h-7"
          >
            {pinging ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Activity className="h-3 w-3" />
            )}
            接続テスト
          </Button>
        </div>
      </header>

      {showStatusPanel && <AutomationStatusPanel spaceId={spaceId} />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              指示を入力してください。例:
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => sendMessage(p)}
                  className="min-h-11 rounded-full border border-border bg-background px-3 py-2 text-xs hover:bg-muted/60 md:min-h-8 md:py-1.5"
                  disabled={sending}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <ChatMessage role={m.role} timestamp={m.timestamp}>
              {m.content}
            </ChatMessage>
            {m.intent && m.modelLabel && (
              <div className="ml-10">
                <SkillSuggestion
                  intent={m.intent}
                  modelLabel={m.modelLabel}
                  onExecute={() => executeIntent(m.id, m.intent!)}
                  onCancel={() =>
                    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, intent: undefined } : x)))
                  }
                  loading={executing === m.id}
                />
              </div>
            )}
            {m.taskId && (
              <div className="ml-10">
                <TaskResultCard taskId={m.taskId} />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <ChatMessage role="assistant">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              考えています...
            </span>
          </ChatMessage>
        )}
      </div>

      <div className="border-t border-border/40 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void sendMessage(input.trim());
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例: 今日のカレンダー整理して"
            disabled={sending}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <Button type="submit" size="icon" className="h-11 w-11 md:h-10 md:w-10" disabled={sending || !input.trim()}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
