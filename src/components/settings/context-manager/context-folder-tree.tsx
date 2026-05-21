'use client'

import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Plus, Pin } from 'lucide-react'
import { FreshnessBadge } from './freshness-badge'
import type { DocumentData, FolderNode } from './types'

interface ContextFolderTreeProps {
  folders: FolderNode[]
  selectedDocId: string | null
  onSelectDocument: (doc: DocumentData) => void
  onCreateDocument: (folderId: string) => void
}

function FolderItem({
  folder,
  depth,
  selectedDocId,
  onSelectDocument,
  onCreateDocument,
}: {
  folder: FolderNode
  depth: number
  selectedDocId: string | null
  onSelectDocument: (doc: DocumentData) => void
  onCreateDocument: (folderId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const hasChildren = folder.children.length > 0 || folder.documents.length > 0

  // 鮮度に問題があるドキュメントがあるか
  const hasStaleDoc = folder.documents.some(d => d.freshness_status === 'stale') ||
    folder.children.some(child =>
      child.documents.some(d => d.freshness_status === 'stale')
    )

  return (
    <div>
      {/* フォルダ行 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        ) : (
          <span className="w-3.5" />
        )}
        {isOpen ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-amber-400" />
        )}
        <span className="truncate font-medium">{folder.title}</span>
        {hasStaleDoc && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
      </button>

      {/* 子要素 */}
      {isOpen && (
        <div>
          {/* ドキュメント */}
          {folder.documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onSelectDocument(doc)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                selectedDocId === doc.id
                  ? 'bg-blue-400/10 text-blue-200'
                  : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="truncate flex-1 text-left">{doc.title}</span>
              {doc.is_pinned && <Pin className="h-3 w-3 shrink-0 text-blue-300" />}
              <FreshnessBadge
                status={doc.freshness_status}
                daysSinceUpdate={doc.days_since_update}
                compact
              />
            </button>
          ))}

          {/* サブフォルダ */}
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedDocId={selectedDocId}
              onSelectDocument={onSelectDocument}
              onCreateDocument={onCreateDocument}
            />
          ))}

          {/* ファイル追加ボタン */}
          {(folder.folder_type === 'root_personal' || folder.folder_type === 'project') && (
            <button
              onClick={() => onCreateDocument(folder.id)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Plus className="h-3 w-3" />
              ファイルを追加
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ContextFolderTree({
  folders,
  selectedDocId,
  onSelectDocument,
  onCreateDocument,
}: ContextFolderTreeProps) {
  return (
    <div className="space-y-1 p-2">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          depth={0}
          selectedDocId={selectedDocId}
          onSelectDocument={onSelectDocument}
          onCreateDocument={onCreateDocument}
        />
      ))}
    </div>
  )
}
