"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, Check, Loader2, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const DEFAULT_MODEL = "gemini-3-flash-preview"

const MODEL_OPTIONS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", note: "新世代のFlashプレビュー標準モデル", badge: "推奨" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "バランス重視の安定版モデル", badge: "安定" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", note: "低遅延・低コストの旧標準モデル", badge: "旧" },
  { id: "glm-5.1", label: "GLM-5.1", note: "外部APIの予備モデル（ローカル向け）", badge: "予備" },
  { id: "kimi-k2.6", label: "Kimi K2.6", note: "品質優先。時間はかかりやすい", badge: "品質" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", note: "品質と速度のバランス", badge: "バランス" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "短い整理を速く返す", badge: "高速" },
  { id: "qwen3.6-plus", label: "Qwen3.6 Plus", note: "軽めの整理向け", badge: "高速" },
  { id: "glm-5", label: "GLM-5", note: "標準候補", badge: "標準" },
  { id: "mimo-v2.5-pro", label: "MiMo-V2.5-Pro", note: "速度寄りの候補", badge: "高速" },
  { id: "mimo-v2.5", label: "MiMo-V2.5", note: "軽量候補", badge: "軽量" },
  { id: "qwen3.5-plus", label: "Qwen3.5 Plus", note: "最軽量候補", badge: "軽量" },
]

export function AiModelSettings() {
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [customModel, setCustomModel] = useState("")
  const [isCustom, setIsCustom] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const modelIds = useMemo(() => new Set(MODEL_OPTIONS.map(option => option.id)), [])
  const selectedValue = isCustom ? "custom" : model
  const effectiveModel = isCustom ? customModel.trim() : model
  const selectedModel = MODEL_OPTIONS.find(option => option.id === model)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/ai/context")
        const data = await res.json()
        const savedModel = typeof data.preferences?.ai_ingest_model === "string"
          ? data.preferences.ai_ingest_model
          : DEFAULT_MODEL
        const normalizedModel =
          savedModel === "gemini-3.0-flash" || savedModel === "gemini-3.1-flash-lite" || savedModel === "gemini-3.5-flash"
            ? DEFAULT_MODEL
            : savedModel
        setModel(normalizedModel)
        if (!modelIds.has(normalizedModel)) {
          setIsCustom(true)
          setCustomModel(normalizedModel)
        }
      } catch {
        setMessage("AIモデル設定を読み込めませんでした")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [modelIds])

  const save = async (nextModel = effectiveModel) => {
    if (!nextModel) {
      setMessage("モデルIDを入力してください")
      return
    }
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/ai/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: { ai_ingest_model: nextModel } }),
      })
      if (!res.ok) throw new Error("保存に失敗しました")
      setModel(nextModel)
      setMessage("保存しました")
    } catch {
      setMessage("保存に失敗しました")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="border-white/10 bg-[#202020] text-zinc-100 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-300" />
          AIモデル
        </CardTitle>
        <CardDescription className="text-zinc-500">
          思考メモの整理に使うモデルを選びます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex min-h-11 items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            読み込み中...
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-white/10 bg-[#171717] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{isCustom ? "カスタムモデル" : selectedModel?.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {isCustom ? "GeminiまたはOpenCode Go互換のモデルIDを直接指定します。" : selectedModel?.note}
                  </p>
                </div>
                <span className="max-w-[220px] truncate rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-xs text-zinc-400">
                  {effectiveModel || "未設定"}
                </span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {MODEL_OPTIONS.map(option => {
                const selected = !isCustom && model === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setIsCustom(false)
                      setModel(option.id)
                      setCustomModel("")
                      save(option.id)
                    }}
                    className={`min-h-[76px] rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? "border-blue-400/40 bg-blue-400/10"
                        : "border-white/10 bg-[#171717] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-zinc-100">{option.label}</span>
                          {option.badge === "高速" && <Zap className="h-3.5 w-3.5 text-amber-500" />}
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">{option.note}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                        selected ? "bg-blue-500 text-white" : "bg-white/[0.06] text-zinc-500"
                      }`}>
                        {selected ? <Check className="inline h-3 w-3" /> : option.badge}
                      </span>
                    </div>
                  </button>
                )
              })}

              <button
                type="button"
                onClick={() => {
                  setIsCustom(true)
                  setCustomModel(modelIds.has(model) ? "" : model)
                }}
                className={`min-h-[76px] rounded-lg border p-3 text-left transition-colors ${
                  selectedValue === "custom"
                    ? "border-blue-400/40 bg-blue-400/10"
                    : "border-white/10 bg-[#171717] hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-zinc-100">カスタム</span>
                    <p className="mt-1 text-xs text-zinc-500">一覧にないモデルIDを使う</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                    selectedValue === "custom" ? "bg-blue-500 text-white" : "bg-white/[0.06] text-zinc-500"
                  }`}>
                    {selectedValue === "custom" ? <Check className="inline h-3 w-3" /> : "ID指定"}
                  </span>
                </div>
              </button>
            </div>

            {selectedValue === "custom" && (
              <Input
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="例: gemini-3-flash-preview"
                className="min-h-[44px] border-white/10 bg-[#171717] text-zinc-100 placeholder:text-zinc-600"
              />
            )}

            <div className="flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500">
                現在: <code className="rounded bg-white/[0.06] px-1 py-0.5 text-zinc-300">{effectiveModel || "未設定"}</code>
              </p>
              <Button onClick={() => save()} disabled={isSaving || !effectiveModel} className="min-h-[44px] bg-blue-500 text-white hover:bg-blue-400">
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isCustom ? "カスタムを保存" : "保存"}
              </Button>
            </div>

            {message && <p className="text-xs text-zinc-500">{message}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
