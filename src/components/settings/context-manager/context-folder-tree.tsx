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
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-sm hover:bg-muted/50 rounded-md transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <span className="w-3.5" />
        )}
        {isOpen ? (
          <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
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
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md transition-colors ${
                selectedDocId === doc.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted/50'
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate flex-1 text-left">{doc.title}</span>
              {doc.is_pinned && <Pin className="w-3 h-3 text-primary shrink-0" />}
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
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Plus className="w-3 h-3" />
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
    <div className="py-2 space-y-1">
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
