"use client"

import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IdealGoal, IdealGoalWithItems } from "@/types/database"

interface IdealEditDialogProps {
    open: boolean
    ideal?: IdealGoal | null
    onOpenChange: (open: boolean) => void
    onSaved: (ideal: IdealGoalWithItems) => void
}

const CATEGORIES = [
    { value: 'appearance', label: '見た目・ビジュアル' },
    { value: 'lifestyle',  label: 'ライフスタイル' },
    { value: 'career',     label: 'キャリア・仕事' },
    { value: 'learning',   label: '学習・スキル' },
    { value: 'other',      label: 'その他' },
]

export function IdealEditDialog({ open, ideal, onOpenChange, onSaved }: IdealEditDialogProps) {
    const isEdit = !!ideal

    const [title, setTitle] = useState(ideal?.title ?? '')
    const [description, setDescription] = useState(ideal?.description ?? '')
    const [category, setCategory] = useState(ideal?.category ?? 'appearance')
    const [durationMonths, setDurationMonths] = useState<string>(
        ideal?.duration_months ? String(ideal.duration_months) : ''
    )
    const [costTotal, setCostTotal] = useState<string>(
        ideal?.cost_total ? String(ideal.cost_total) : ''
    )
    const [costMonthly, setCostMonthly] = useState<string>(
        ideal?.cost_monthly ? String(ideal.cost_monthly) : ''
    )
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async () => {
        if (!title.trim()) { setError('タイトルは必須です'); return }
        setError(null)
        setIsLoading(true)

        try {
            const body = {
                title: title.trim(),
                description: description.trim() || null,
                category,
                duration_months: durationMonths ? Number(durationMonths) : null,
                cost_total: costTotal ? Number(costTotal) : null,
                cost_monthly: costMonthly ? Number(costMonthly) : null,
            }

            let res: Response
            if (isEdit) {
                res = await fetch(`/api/ideals/${ideal!.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                })
            } else {
                res = await fetch('/api/ideals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                })
            }

            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return }

            onSaved(data.ideal)
        } catch {
            setError('通信エラーが発生しました')
        } finally {
            setIsLoading(false)
        }
    }

    const handleOpenChange = (v: boolean) => {
        if (!v) {
            // リセット
            setTitle(ideal?.title ?? '')
            setDescription(ideal?.description ?? '')
            setCategory(ideal?.category ?? 'appearance')
            setDurationMonths(ideal?.duration_months ? String(ideal.duration_months) : '')
            setCostTotal(ideal?.cost_total ? String(ideal.cost_total) : '')
            setCostMonthly(ideal?.cost_monthly ? String(ideal.cost_monthly) : '')
            setError(null)
        }
        onOpenChange(v)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{isEdit ? '理想を編集' : '理想を追加'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* タイトル */}
                    <div className="space-y-1.5">
                        <Label htmlFor="ideal-title">タイトル *</Label>
                        <Input
                            id="ideal-title"
                            placeholder="例: このビジュアルになりたい"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                        />
                    </div>

                    {/* カテゴリ */}
                    <div className="space-y-1.5">
                        <Label htmlFor="ideal-category">カテゴリ</Label>
                        <select
                            id="ideal-category"
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                            {CATEGORIES.map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* 説明 */}
                    <div className="space-y-1.5">
                        <Label htmlFor="ideal-desc">説明・メモ</Label>
                        <textarea
                            id="ideal-desc"
                            placeholder="どんな自分になりたいか、具体的に書いてみよう"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                        />
                    </div>

                    {/* 期間 */}
                    <div className="space-y-1.5">
                        <Label htmlFor="ideal-duration">目標期間（ヶ月）</Label>
                        <Input
                            id="ideal-duration"
                            type="number"
                            min={1}
                            placeholder="例: 12（1年）、3（3ヶ月）"
                            value={durationMonths}
                            onChange={e => setDurationMonths(e.target.value)}
                        />
                    </div>

                    {/* 費用 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="ideal-cost-total">総費用概算（円）</Label>
                            <Input
                                id="ideal-cost-total"
                                type="number"
                                min={0}
                                placeholder="例: 150000"
                                value={costTotal}
                                onChange={e => setCostTotal(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ideal-cost-monthly">月次費用（円）</Label>
                            <Input
                                id="ideal-cost-monthly"
                                type="number"
                                min={0}
                                placeholder="例: 3000"
                                value={costMonthly}
                                onChange={e => setCostMonthly(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)}>
                        キャンセル
                    </Button>
                    <Button onClick={handleSubmit} disabled={isLoading}>
                        {isLoading ? '保存中...' : isEdit ? '更新' : '追加'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
