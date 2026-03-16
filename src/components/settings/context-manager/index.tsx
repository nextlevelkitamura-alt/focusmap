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
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadData}>再読み込み</Button>
      </div>
    )
  }

  const availableDocTypes = createDialog?.folderType === 'project' ? PROJECT_DOC_TYPES : PERSONAL_DOC_TYPES

  return (
    <div className="flex flex-col h-full">
      {/* 新規ドキュメント作成ダイアログ */}
      <Dialog open={!!createDialog} onOpenChange={(open) => !open && setCreateDialog(null)}>
        <DialogContent className="sm:max-w-sm">
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
                className="w-full text-sm border rounded-md px-3 py-2 bg-background outline-none focus:ring-2 focus:ring-ring/50"
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
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <button onClick={onBack ?? (() => router.back())} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Brain className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">コンテキスト管理</h2>
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左ペイン: フォルダツリー（デスクトップ常時表示、モバイルはエディタ非表示時） */}
        <div className={`w-full md:w-64 md:border-r md:block ${mobileShowEditor ? 'hidden' : 'block'}`}>
          <ScrollArea className="h-full">
            <ContextFolderTree
              folders={folders}
              selectedDocId={selectedDoc?.id ?? null}
              onSelectDocument={handleSelectDocument}
              onCreateDocument={handleCreateDocument}
            />
          </ScrollArea>
        </div>

        {/* 右ペイン: ドキュメントエディタ */}
        <div className={`flex-1 md:block ${mobileShowEditor ? 'block' : 'hidden md:block'}`}>
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
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-6 gap-4 max-w-sm mx-auto">
              <Brain className="w-12 h-12 opacity-20" />
              <div className="text-center space-y-2">
                <p className="text-sm font-medium text-foreground">
                  AIがあなたを理解するための情報を管理
                </p>
                <p className="text-xs leading-relaxed">
                  左のファイルを選択して、自分のことやプロジェクトの情報を入力してください。
                  AIはここに保存された情報をもとに、あなたに合った提案をします。
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1.5 w-full">
                <p className="font-medium text-foreground">まずはここから:</p>
                <p>1. 「性格・ライフスタイル」に働き方や生活リズムを記入</p>
                <p>2. 「今の状況」に最近の状況や悩みを記入</p>
                <p>3. AIチャットで話すだけでも自動的に学習します</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
