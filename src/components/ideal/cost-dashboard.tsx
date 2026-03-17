"use client"

import { useMemo } from "react"
import { IdealGoalWithItems, calcMonthlyCost, CostType } from "@/types/database"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

interface CostDashboardProps {
    ideals: IdealGoalWithItems[]
}

const CHART_COLORS = [
    '#ec4899', // pink
    '#10b981', // emerald
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#f59e0b', // amber
]

const CATEGORY_COLORS: Record<string, string> = {
    appearance: '#ec4899',
    lifestyle: '#10b981',
    career: '#3b82f6',
    learning: '#8b5cf6',
    other: '#f59e0b',
}

export function CostDashboard({ ideals }: CostDashboardProps) {
    const activeIdeals = ideals.filter(i => i.status === 'active')

    const { totalMonthly, totalAnnual, totalOnce, pieData, barData, costItems } = useMemo(() => {
        let totalMonthly = 0
        let totalAnnual = 0
        let totalOnce = 0

        const pieData: { name: string; value: number; color: string }[] = []
        const barData: { name: string; monthly: number; once: number; color: string }[] = []
        const costItems: { idealTitle: string; itemTitle: string; cost: number; costType: string; monthlyEquiv: number }[] = []

        for (const ideal of activeIdeals) {
            let goalMonthly = 0
            let goalOnce = 0

            for (const item of ideal.ideal_items ?? []) {
                if (!item.item_cost || item.item_cost <= 0) continue

                const ct = (item.cost_type || 'once') as CostType
                const monthly = calcMonthlyCost(ct, item.item_cost, ideal.duration_months)

                if (ct === 'once') {
                    totalOnce += item.item_cost
                    goalOnce += item.item_cost
                } else if (ct === 'monthly') {
                    totalMonthly += item.item_cost
                    goalMonthly += item.item_cost
                } else if (ct === 'annual') {
                    totalAnnual += item.item_cost
                    goalMonthly += monthly
                }

                costItems.push({
                    idealTitle: ideal.title,
                    itemTitle: item.title,
                    cost: item.item_cost,
                    costType: ct,
                    monthlyEquiv: monthly,
                })
            }

            if (goalMonthly > 0 || goalOnce > 0) {
                const color = CATEGORY_COLORS[ideal.category ?? 'other'] ?? '#94a3b8'
                pieData.push({
                    name: ideal.title,
                    value: goalMonthly + Math.round(goalOnce / 12),
                    color,
                })
                barData.push({
                    name: ideal.title.length > 6 ? ideal.title.slice(0, 6) + '…' : ideal.title,
                    monthly: goalMonthly,
                    once: goalOnce,
                    color,
                })
            }
        }

        return { totalMonthly, totalAnnual, totalOnce, pieData, barData, costItems }
    }, [activeIdeals])

    const totalMonthlyAll = totalMonthly + Math.round(totalAnnual / 12)

    return (
        <div className="space-y-4">
            {/* KPIカード */}
            <div className="grid grid-cols-3 gap-3">
                <KpiCard label="月額" value={totalMonthlyAll} suffix="/月" />
                <KpiCard label="一括費用" value={totalOnce} />
                <KpiCard label="年間" value={totalMonthlyAll * 12 + totalOnce} />
            </div>

            {/* 円グラフ + 棒グラフ */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 理想別コスト構成比 */}
                {pieData.length > 0 && (
                    <div className="rounded-xl border p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3">理想別コスト構成</p>
                        <div className="flex items-center justify-center">
                            <ResponsiveContainer width={200} height={200}>
                                <PieChart>
                                    <Pie
                                        data={pieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
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
                                <span key={i} className="inline-flex items-center gap-1 text-[10px]">
                                    <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                                    {d.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* 理想別内訳棒グラフ */}
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
                                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                                    <div className="min-w-0">
                                        <span className="text-[10px] text-muted-foreground mr-1.5">{item.idealTitle}</span>
                                        <span className="truncate">{item.itemTitle}</span>
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

function KpiCard({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
    return (
        <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1 tabular-nums">
                ¥{value.toLocaleString()}
                {suffix && <span className="text-sm font-normal text-muted-foreground">{suffix}</span>}
            </p>
        </div>
    )
}
