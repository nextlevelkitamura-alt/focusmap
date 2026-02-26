'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Brain, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ContextFolderTree } from './context-folder-tree'
import { ContextDocumentEditor } from './context-document-editor'
import type { DocumentData, FolderNode } from './types'

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

  // 新規ドキュメント作成
  const handleCreateDocument = useCallback(async (folderId: string) => {
    const res = await fetch('/api/ai/context/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder_id: folderId,
        title: '新しいメモ',
        document_type: 'note',
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    await loadData()
    // 作成したドキュメントを選択
    setSelectedDoc({
      ...data.document,
      freshness_score: 1,
      freshness_status: 'fresh',
      days_since_update: 0,
    })
    setMobileShowEditor(true)
  }, [loadData])

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

  return (
    <div className="flex flex-col h-full">
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
