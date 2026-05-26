'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface AnalyticsChartProps {
  data: Array<{
    billing_cycle: string;
    executions: number;
    cost_usd: number;
  }>;
}

export function AnalyticsChart({ data }: AnalyticsChartProps) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="billing_cycle"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(2).replace('-', '/')}
          />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border)',
              backgroundColor: 'var(--background)',
            }}
            formatter={(v) => [`${v}回`, '実行'] as [string, string]}
            labelFormatter={(label) => `${String(label)} 月`}
          />
          <Bar dataKey="executions" fill="oklch(0.6 0.18 245)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
