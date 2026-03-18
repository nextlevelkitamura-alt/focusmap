"use client"

import { useMemo } from "react"
import { IdealGoalWithItems, calcMonthlyCost, calcMonthlySavings, CostType } from "@/types/database"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

interface CostDashboardProps {
    ideals: IdealGoalWithItems[]
}

const CATEGORY_COLORS: Record<string, string> = {
    appearance: '#ec4899',
    lifestyle: '#10b981',
    career: '#3b82f6',
    learning: '#8b5cf6',
    other: '#f59e0b',
}

interface GoalSavingsSummary {
    title: string
    color: string
    monthlyFixed: number      // 月額固定費（monthly + annual/12）
    onceCostTotal: number     // 一括費用の合計
    onceCostPaid: number      // 支払い済み一括費用
    monthlySavings: number    // 月々の必要積立額
    monthsLeft: number | null // 残り月数
    targetDate: string | null
}

export function CostDashboard({ ideals }: CostDashboardProps) {
    const activeIdeals = ideals.filter(i => i.status === 'active')

    const { goalSummaries, totalMonthlyFixed, totalMonthlySavings, pieData, barData, costItems } = useMemo(() => {
        let totalMonthlyFixed = 0
        let totalMonthlySavings = 0

        const goalSummaries: GoalSavingsSummary[] = []
        const pieData: { name: string; value: number; color: string }[] = []
        const barData: { name: string; monthly: number; once: number; color: string }[] = []
        const costItems: { idealTitle: string; itemTitle: string; cost: number; costType: string; monthlyEquiv: number; isDone: boolean }[] = []

        for (const ideal of activeIdeals) {
            let goalMonthlyFixed = 0
            let goalOnceCostTotal = 0
            let goalOnceCostPaid = 0
            let goalOnceRaw = 0

            for (const item of ideal.ideal_items ?? []) {
                if (!item.item_cost || item.item_cost <= 0) continue

                const ct = (item.cost_type || 'once') as CostType
                const monthly = calcMonthlyCost(ct, item.item_cost, ideal.duration_months)

                if (ct === 'once') {
                    goalOnceCostTotal += item.item_cost
                    goalOnceRaw += item.item_cost
                    if (item.is_done) {
                        goalOnceCostPaid += item.item_cost
                    }
                } else if (ct === 'monthly') {
                    goalMonthlyFixed += item.item_cost
                } else if (ct === 'annual') {
                    goalMonthlyFixed += monthly
                }

                costItems.push({
                    idealTitle: ideal.title,
                    itemTitle: item.title,
                    cost: item.item_cost,
                    costType: ct,
                    monthlyEquiv: monthly,
                    isDone: item.is_done ?? false,
                })
            }

            const savings = calcMonthlySavings(goalOnceCostTotal, ideal.target_date, goalOnceCostPaid)
            const monthsLeft = calcMonthsLeft(ideal.target_date)

            totalMonthlyFixed += goalMonthlyFixed
            totalMonthlySavings += savings

            const color = CATEGORY_COLORS[ideal.category ?? 'other'] ?? '#94a3b8'

            if (goalMonthlyFixed > 0 || goalOnceCostTotal > 0) {
                goalSummaries.push({
                    title: ideal.title,
                    color,
                    monthlyFixed: goalMonthlyFixed,
                    onceCostTotal: goalOnceCostTotal,
                    onceCostPaid: goalOnceCostPaid,
                    monthlySavings: savings,
                    monthsLeft,
                    targetDate: ideal.target_date,
                })

                pieData.push({
                    name: ideal.title,
                    value: goalMonthlyFixed + savings,
                    color,
                })
                barData.push({
                    name: ideal.title.length > 6 ? ideal.title.slice(0, 6) + '…' : ideal.title,
                    monthly: goalMonthlyFixed,
                    once: goalOnceRaw,
                    color,
                })
            }
        }

        return { goalSummaries, totalMonthlyFixed, totalMonthlySavings, pieData, barData, costItems }
    }, [activeIdeals])

    const totalMonthlyAll = totalMonthlyFixed + totalMonthlySavings

    return (
        <div className="space-y-4">
            {/* KPIカード */}
            <div className="grid grid-cols-3 gap-3">
                <KpiCard label="月額固定" value={totalMonthlyFixed} suffix="/月" sublabel="月払い+年割り" />
                <KpiCard label="月額積立" value={totalMonthlySavings} suffix="/月" sublabel="一括÷残り月数" />
                <KpiCard
                    label="合計/月"
                    value={totalMonthlyAll}
                    suffix="/月"
                    highlight
                />
            </div>

            {/* 理想別の貯蓄進捗 */}
            {goalSummaries.length > 0 && (
                <div className="rounded-xl border p-4 space-y-4">
                    <p className="text-xs font-medium text-muted-foreground">理想別の貯蓄進捗</p>
                    {goalSummaries.map((g, i) => {
                        const oncePaidPercent = g.onceCostTotal > 0
                            ? Math.min(100, Math.round((g.onceCostPaid / g.onceCostTotal) * 100))
                            : 100
                        const remaining = g.onceCostTotal - g.onceCostPaid

                        return (
                            <div key={i} className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                                    <span className="text-sm font-medium truncate">{g.title}</span>
                                </div>

                                {/* 月額の内訳 */}
                                <div className="ml-4.5 grid grid-cols-2 gap-2 text-xs">
                                    {g.monthlyFixed > 0 && (
                                        <div className="text-muted-foreground">
                                            固定費: <span className="text-foreground font-medium">¥{g.monthlyFixed.toLocaleString()}/月</span>
                                        </div>
                                    )}
                                    {g.monthlySavings > 0 && (
                                        <div className="text-muted-foreground">
                                            積立: <span className="text-foreground font-medium">¥{g.monthlySavings.toLocaleString()}/月</span>
                                        </div>
                                    )}
                                </div>

                                {/* 一括費用の進捗バー */}
                                {g.onceCostTotal > 0 && (
                                    <div className="ml-4.5 space-y-1">
                                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{
                                                    width: `${oncePaidPercent}%`,
                                                    background: g.color,
                                                }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>
                                                {oncePaidPercent === 100
                                                    ? '完済'
                                                    : `残り ¥${remaining.toLocaleString()}`
                                                }
                                            </span>
                                            <span>
                                                {g.monthsLeft !== null && g.monthsLeft > 0
                                                    ? `あと${g.monthsLeft}ヶ月`
                                                    : g.targetDate
                                                        ? '期限超過'
                                                        : '期限未設定'
                                                }
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* 円グラフ + 棒グラフ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pieData.length > 0 && (
                    <div className="rounded-xl border p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3">月額ペース構成</p>
                        <div className="flex items-center justify-center">
                            <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={75}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {pieData.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value) => `¥${Number(value).toLocaleString()}/月`}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center mt-2">
                            {pieData.map((d, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-xs">
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                                    {d.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {barData.length > 0 && (
                    <div className="rounded-xl border p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3">理想別内訳</p>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10 }}>
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                                <Tooltip
                                    formatter={(value, name) =>
                                        [`¥${Number(value).toLocaleString()}`, name === 'monthly' ? '月額' : '一括']
                                    }
                                />
                                <Bar dataKey="monthly" stackId="cost" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="once" stackId="cost" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                        <div className="flex gap-3 justify-center text-[10px] text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-sm bg-blue-500" /> 月額
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-sm bg-amber-500" /> 一括
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* アイテム一覧テーブル */}
            <div className="rounded-xl border p-4">
                <p className="text-xs font-medium text-muted-foreground mb-3">コストアイテム一覧</p>
                {costItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground/50 text-center py-4">コストアイテムなし</p>
                ) : (
                    <div className="space-y-1.5">
                        {costItems
                            .sort((a, b) => b.monthlyEquiv - a.monthlyEquiv)
                            .map((item, i) => (
                                <div key={i} className={`flex items-center justify-between text-sm py-2.5 border-b last:border-0 ${item.isDone ? 'opacity-50' : ''}`}>
                                    <div className="min-w-0 flex items-center gap-1.5">
                                        {item.isDone && <span className="text-xs">✅</span>}
                                        <span className="text-[10px] text-muted-foreground mr-1.5">{item.idealTitle}</span>
                                        <span className={`truncate ${item.isDone ? 'line-through' : ''}`}>{item.itemTitle}</span>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-2">
                                        <span className="font-medium">
                                            ¥{item.cost.toLocaleString()}
                                            {item.costType === 'monthly' && '/月'}
                                            {item.costType === 'annual' && '/年'}
                                        </span>
                                        {item.costType !== 'monthly' && (
                                            <span className="text-[10px] text-muted-foreground ml-1">
                                                (月¥{item.monthlyEquiv.toLocaleString()})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function KpiCard({ label, value, suffix = '', sublabel, highlight }: {
    label: string
    value: number
    suffix?: string
    sublabel?: string
    highlight?: boolean
}) {
    return (
        <div className={`rounded-xl border p-4 ${highlight ? 'border-primary/30 bg-primary/5' : ''}`}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${highlight ? 'text-primary' : ''}`}>
                ¥{value.toLocaleString()}
                {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
            </p>
            {sublabel && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>
            )}
        </div>
    )
}

function calcMonthsLeft(targetDate: string | null): number | null {
    if (!targetDate) return null
    const now = new Date()
    const target = new Date(targetDate)
    return Math.max(0,
        (target.getFullYear() - now.getFullYear()) * 12 +
        (target.getMonth() - now.getMonth())
    )
}
