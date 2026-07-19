import { Badge } from '@/components/ui/badge';

// program.md/plan.md 冒頭のメタ行（分類/種別/規模/優先…）をBadge帯として表示する。
// 表示順は固定（読み手が毎回同じ位置で拾える方が良い）。値が無いラベルは出さない。
const ORDER = ['優先', '規模', '分類', '種別', '形態'];

export function MetaBadges({ meta, className }: { meta: Map<string, string>; className?: string }) {
  const entries = ORDER.filter((label) => meta.has(label)).map((label) => [label, meta.get(label) as string] as const);
  if (entries.length === 0) return null;
  return (
    <div className={className ?? 'flex flex-wrap gap-1.5'}>
      {entries.map(([label, value]) => (
        <Badge key={label} variant="secondary" className="font-normal">
          {label === '優先' ? value : `${label}: ${value}`}
        </Badge>
      ))}
    </div>
  );
}
