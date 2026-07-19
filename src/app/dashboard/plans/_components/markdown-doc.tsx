import type { ReactNode } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { resolveRelativeLink, stripMetaHeader } from '../_lib/md-parse';

// 子07: md本文を読みやすくレンダリングする読み取り専用ビューア。
// - GFMチェックボックスはボード世界観の✓/○表示（disabled input は描画しない）
// - 表・コードは横スクロールコンテナで囲む
// - h2単位で <details> 折り畳み（JS不要）
// - 相対リンクは同一計画内の既知パスへ内部ルート解決。解決できなければグレー非リンク
// - 画像はプレースホルダ（実画像は取得しない）
// 書込みUI・server actionは一切持たない。

type Section = { heading: string | null; content: string };

function splitSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  let current: string[] = [];
  let currentHeading: string | null = null;
  for (const line of lines) {
    if (/^##(?!#)\s+/.test(line)) {
      sections.push({ heading: currentHeading, content: current.join('\n') });
      currentHeading = line.replace(/^##\s+/, '').trim();
      current = [];
    } else {
      current.push(line);
    }
  }
  sections.push({ heading: currentHeading, content: current.join('\n') });
  return sections;
}

function buildComponents(opts: { slug: string; currentPath: string; knownPaths: Set<string> }): Components {
  const { slug, currentPath, knownPaths } = opts;
  return {
    h1: ({ children }) => <h1 className="mb-2 text-lg font-bold">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-1.5 mt-4 text-base font-bold">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-bold">{children}</h3>,
    p: ({ children }) => <p className="mb-2 whitespace-pre-wrap break-words text-[15px] leading-[1.75]">{children}</p>,
    ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 text-[15px] leading-[1.75]">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 text-[15px] leading-[1.75]">{children}</ol>,
    li: ({ children, className }) => (
      <li className={cn('break-words', className)}>{children}</li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    code: ({ children, className }) => {
      const isBlock = /language-/.test(className || '');
      if (isBlock) return <code className={className}>{children}</code>;
      return <code className="rounded bg-muted px-1 py-0.5 text-[13px]">{children}</code>;
    },
    pre: ({ children }) => (
      <pre className="mb-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-[13px]">{children}</pre>
    ),
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-max border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
    th: ({ children }) => <th className="border-b border-border px-2 py-1.5 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
    img: ({ alt }) => (
      <span className="mb-2 flex h-24 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
        画像（{alt || '無題'}）はここでは表示されません
      </span>
    ),
    a: ({ href, children }) => {
      const resolved = href ? resolveRelativeLink(currentPath, href, knownPaths) : null;
      if (resolved) {
        return (
          <Link href={`/dashboard/plans/${encodeURIComponent(slug)}/doc?p=${encodeURIComponent(resolved)}`} className="font-medium text-primary underline underline-offset-2">
            {children}
          </Link>
        );
      }
      if (href && /^https?:\/\//i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
            {children}
          </a>
        );
      }
      return <span className="text-muted-foreground/60">{children}</span>;
    },
    // GFMタスクリストの <input type="checkbox" disabled> を、ボード世界観の✓/○に差し替える。
    input: ({ type, checked }) => {
      if (type !== 'checkbox') return null;
      return checked ? (
        <span className="mr-1.5 inline-block font-bold text-emerald-600">✓</span>
      ) : (
        <span className="mr-1.5 inline-block text-muted-foreground/50">○</span>
      );
    },
  };
}

function Section({ section, components, defaultOpen }: { section: Section; components: Components; defaultOpen: boolean }): ReactNode {
  if (section.heading === null) {
    return section.content.trim() ? (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {section.content}
      </ReactMarkdown>
    ) : null;
  }
  return (
    <details open={defaultOpen} className="mb-2 rounded-lg border border-border/60 px-3 py-2">
      <summary className="cursor-pointer select-none text-base font-bold text-foreground">{section.heading}</summary>
      <div className="mt-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {section.content}
        </ReactMarkdown>
      </div>
    </details>
  );
}

export function MarkdownDoc({
  body,
  path,
  slug,
  knownPaths,
}: {
  body: string;
  path: string;
  slug: string;
  knownPaths: Set<string>;
}) {
  const stripped = stripMetaHeader(body);
  const sections = splitSections(stripped);
  const components = buildComponents({ slug, currentPath: path, knownPaths });
  return (
    <div className="min-w-0">
      {sections.map((section, index) => (
        <Section key={`${section.heading ?? 'intro'}-${index}`} section={section} components={components} defaultOpen />
      ))}
    </div>
  );
}
