"use client"

import { useState, useRef, useCallback } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Upload, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface IdealCoverUploadProps {
    open: boolean
    idealId: string
    onOpenChange: (open: boolean) => void
    onUploaded: (url: string) => void
}

export function IdealCoverUpload({ open, idealId, onOpenChange, onUploaded }: IdealCoverUploadProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [preview, setPreview] = useState<string | null>(null)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('画像ファイルを選択してください')
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            setError('ファイルサイズは10MB以内にしてください')
            return
        }
        setError(null)
        setSelectedFile(file)
        const url = URL.createObjectURL(file)
        setPreview(url)
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleUpload = async () => {
        if (!selectedFile) return
        setIsUploading(true)
        setError(null)

        try {
            const formData = new FormData()
            formData.append('file', selectedFile)
            const res = await fetch(`/api/ideals/${idealId}/cover`, {
                method: 'POST',
                body: formData,
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'アップロードに失敗しました'); return }
            onUploaded(data.ideal.cover_image_url)
        } catch {
            setError('通信エラーが発生しました')
        } finally {
            setIsUploading(false)
        }
    }

    const handleClose = () => {
        setPreview(null)
        setSelectedFile(null)
        setError(null)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>カバー画像を変更</DialogTitle>
                </DialogHeader>

                {preview ? (
                    <div className="relative rounded-lg overflow-hidden aspect-[3/4]">
                        <img src={preview} alt="preview" className="w-full h-full object-cover" />
                        <button
                            onClick={() => { setPreview(null); setSelectedFile(null) }}
                            className="absolute top-2 right-2 bg-black/50 rounded-full p-1 text-white hover:bg-black/70"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ) : (
                    <div
                        onDrop={handleDrop}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                        onDragLeave={() => setIsDragging(false)}
                        onClick={() => inputRef.current?.click()}
                        className={cn(
                            "rounded-lg border-2 border-dashed cursor-pointer transition-colors",
                            "flex flex-col items-center justify-center gap-3 py-12",
                            isDragging
                                ? "border-primary bg-primary/5"
                                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30"
                        )}
                    >
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <div className="text-center text-sm">
                            <p className="font-medium">画像をドラッグ&ドロップ</p>
                            <p className="text-xs text-muted-foreground mt-0.5">またはクリックして選択（10MB以内）</p>
                        </div>
                    </div>
                )}

                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={handleClose}>キャンセル</Button>
                    {selectedFile && (
                        <Button onClick={handleUpload} disabled={isUploading}>
                            {isUploading ? 'アップロード中...' : 'アップロード'}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
