'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Brain, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ContextFolderTree } from './context-folder-tree'
import { ContextDocumentEditor } from './context-document-editor'
import type { DocumentData, FolderNode } from './types'

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  personality: '性格・生活スタイル',
  purpose: '目標・ビジョン',
  situation: '現在の状況',
  project_purpose: 'プロジェクトの目的',
  project_status: '進捗状況',
  project_insights: '重要な気づき',
  note: 'メモ',
}

const PERSONAL_DOC_TYPES = ['personality', 'purpose', 'situation', 'note']
const PROJECT_DOC_TYPES = ['project_purpose', 'project_status', 'project_insights', 'note']

interface ContextManagerProps {
  onBack?: () => void
}

export function ContextManager({ onBack }: ContextManagerProps) {
  const router = useRouter()
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [selectedDoc, setSelectedDoc] = useState<DocumentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // モバイルで「エディタ表示中」かどうか
  const [mobileShowEditor, setMobileShowEditor] = useState(false)
  // 新規作成ダイアログ
  const [createDialog, setCreateDialog] = useState<{ folderId: string; folderType: string } | null>(null)
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocType, setNewDocType] = useState('note')
  const [creating, setCreating] = useState(false)

  // 初期化 + データ取得
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 初期化（Lazy Migration）
      await fetch('/api/ai/context/initialize', { method: 'POST' })

      // ツリー取得
      const res = await fetch('/api/ai/context/folders')
      if (!res.ok) throw new Error('Failed to fetch folders')
      const data = await res.json()
      setFolders(data.folders || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // 初回ロード後、未入力のドキュメントがあれば自動選択（オンボーディング）
  const [hasAutoSelected, setHasAutoSelected] = useState(false)
  useEffect(() => {
    if (hasAutoSelected || loading || folders.length === 0 || selectedDoc) return
    // 「自分について」フォルダ内の最初の空ドキュメントを探す
    const personalFolder = folders.find(f => f.folder_type === 'root_personal')
    if (personalFolder) {
      const emptyDoc = personalFolder.documents.find(d => !d.content)
      if (emptyDoc) {
        setSelectedDoc(emptyDoc)
        setHasAutoSelected(true)
        return
      }
    }
    setHasAutoSelected(true)
  }, [hasAutoSelected, loading, folders, selectedDoc])

  // ドキュメント選択
  const handleSelectDocument = useCallback((doc: DocumentData) => {
    setSelectedDoc(doc)
    setMobileShowEditor(true)
  }, [])

  // エディタから戻る
  const handleBack = useCallback(() => {
    setSelectedDoc(null)
    setMobileShowEditor(false)
    loadData() // リフレッシュ
  }, [loadData])

  // ドキュメント保存
  const handleSave = useCallback(async (id: string, updates: { title?: string; content?: string; is_pinned?: boolean }) => {
    const res = await fetch(`/api/ai/context/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error('保存に失敗しました')
    const data = await res.json()
    // 選択中のドキュメントを更新
    if (selectedDoc && selectedDoc.id === id) {
      setSelectedDoc(prev => prev ? { ...prev, ...data.document, freshness_status: prev.freshness_status, freshness_score: prev.freshness_score, days_since_update: prev.days_since_update } : null)
    }
  }, [selectedDoc])

  // ドキュメント削除
  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/ai/context/documents/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('削除に失敗しました')
  }, [])

  // 鮮度レビュー
  const handleReview = useCallback(async (id: string) => {
    const res = await fetch(`/api/ai/context/documents/${id}/review`, { method: 'POST' })
    if (!res.ok) throw new Error('レビューに失敗しました')
    // リフレッシュ
    await loadData()
    // 選択中のドキュメントを再取得
    if (selectedDoc?.id === id) {
      const allDocs = folders.flatMap(f => [...f.documents, ...f.children.flatMap(c => c.documents)])
      const updated = allDocs.find(d => d.id === id)
      if (updated) setSelectedDoc(updated)
    }
  }, [selectedDoc, folders, loadData])

  // 新規ドキュメント作成（ダイアログ表示）
  const handleCreateDocument = useCallback((folderId: string) => {
    const folder = folders.find(f => f.id === folderId) ||
      folders.flatMap(f => f.children).find(f => f.id === folderId)
    const folderType = folder?.folder_type ?? 'root_personal'
    const defaultType = folderType === 'project' ? 'project_purpose' : 'note'
    setNewDocTitle('')
    setNewDocType(defaultType)
    setCreateDialog({ folderId, folderType })
  }, [folders])

  // ダイアログ確定
  const handleConfirmCreate = useCallback(async () => {
    if (!createDialog) return
    setCreating(true)
    try {
      const res = await fetch('/api/ai/context/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: createDialog.folderId,
          title: newDocTitle || DOCUMENT_TYPE_LABELS[newDocType] || '新しいドキュメント',
          document_type: newDocType,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      setCreateDialog(null)
      await loadData()
      setSelectedDoc({
        ...data.document,
        freshness_score: 1,
        freshness_status: 'fresh',
        days_since_update: 0,
      })
      setMobileShowEditor(true)
    } finally {
      setCreating(false)
    }
  }, [createDialog, newDocTitle, newDocType, loadData])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#111111] p-8">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#111111] p-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadData}>再読み込み</Button>
      </div>
    )
  }

  const availableDocTypes = createDialog?.folderType === 'project' ? PROJECT_DOC_TYPES : PERSONAL_DOC_TYPES

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111111] text-zinc-100">
      {/* 新規ドキュメント作成ダイアログ */}
      <Dialog open={!!createDialog} onOpenChange={(open) => !open && setCreateDialog(null)}>
        <DialogContent className="border-white/10 bg-[#202020] text-zinc-100 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ドキュメントを追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">種別</label>
              <Select value={newDocType} onValueChange={setNewDocType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableDocTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">タイトル（省略可）</label>
              <input
                type="text"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                placeholder={DOCUMENT_TYPE_LABELS[newDocType]}
                className="w-full rounded-md border border-white/10 bg-[#171717] px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-blue-400/50"
                onKeyDown={(e) => e.key === 'Enter' && handleConfirmCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateDialog(null)}>キャンセル</Button>
            <Button size="sm" onClick={handleConfirmCreate} disabled={creating}>
              {creating ? '作成中...' : '作成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ヘッダー */}
      <div className="flex min-h-16 items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
        <button onClick={onBack ?? (() => router.push('/dashboard/settings'))} className="flex min-h-10 items-center gap-2 rounded-md text-sm text-zinc-400 transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">設定へ戻る</span>
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-400/10 text-violet-200">
          <Brain className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-50">AIコンテキスト管理</h2>
          <p className="hidden text-xs text-zinc-500 sm:block">AIに渡す自分・プロジェクト情報を編集します</p>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="min-h-0 flex-1 overflow-hidden p-4 md:p-6">
        {/* 左ペイン: フォルダツリー（デスクトップ常時表示、モバイルはエディタ非表示時） */}
        <div className="grid h-full gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className={`min-h-0 overflow-hidden rounded-xl border border-white/10 bg-[#202020] lg:block ${mobileShowEditor ? 'hidden' : 'block'}`}>
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-100">フォルダ</p>
              <p className="mt-1 text-xs text-zinc-500">自分の情報とプロジェクト情報</p>
            </div>
            <ScrollArea className="h-[calc(100%-57px)]">
              <ContextFolderTree
                folders={folders}
                selectedDocId={selectedDoc?.id ?? null}
                onSelectDocument={handleSelectDocument}
                onCreateDocument={handleCreateDocument}
              />
            </ScrollArea>
          </div>

          {/* 右ペイン: ドキュメントエディタ */}
          <div className={`min-h-0 overflow-hidden rounded-xl border border-white/10 bg-[#202020] lg:block ${mobileShowEditor ? 'block' : 'hidden lg:block'}`}>
            {selectedDoc ? (
              <ContextDocumentEditor
                key={selectedDoc.id}
                document={selectedDoc}
                onBack={handleBack}
                onSave={handleSave}
                onDelete={handleDelete}
                onReview={handleReview}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-zinc-500">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-400/10 text-violet-200">
                  <Brain className="h-7 w-7" />
                </div>
                <div className="max-w-md space-y-2 text-center">
                  <p className="text-sm font-medium text-zinc-100">
                    AIがあなたを理解するための情報を管理
                  </p>
                  <p className="text-xs leading-6 text-zinc-500">
                    左のファイルを選択して、自分のことやプロジェクトの情報を入力してください。
                    AIはここに保存された情報をもとに、あなたに合った提案をします。
                  </p>
                </div>
                <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#171717] p-4 text-xs leading-5 text-zinc-400">
                  <p className="font-medium text-zinc-100">まずはここから</p>
                  <p className="mt-2">1. 「性格・ライフスタイル」に働き方や生活リズムを記入</p>
                  <p>2. 「今の状況」に最近の状況や悩みを記入</p>
                  <p>3. AIチャットで話すだけでも自動的に学習します</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
