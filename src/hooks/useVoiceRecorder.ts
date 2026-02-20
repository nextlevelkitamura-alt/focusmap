"use client"

import { useState, useRef, useCallback } from "react"

interface UseVoiceRecorderReturn {
  isRecording: boolean
  isTranscribing: boolean
  error: string | null
  startRecording: () => Promise<void>
  stopRecording: () => void
}

export function useVoiceRecorder(
  onTranscribed: (text: string) => void
): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // iPhone Safari は WebM 非対応 → MP4/AAC にフォールバック
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/wav'

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType === 'audio/wav' ? undefined : mimeType,
      })

      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        // マイクを開放
        stream.getTracks().forEach(track => track.stop())

        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []

        if (audioBlob.size === 0) {
          setError('録音データが空です')
          return
        }

        // 文字起こし API に送信
        setIsTranscribing(true)
        try {
          // ファイル拡張子をMIMEタイプから決定
          const ext = mimeType.includes('webm') ? 'webm'
            : mimeType.includes('mp4') ? 'mp4'
            : 'wav'

          const formData = new FormData()
          formData.append('audio', audioBlob, `recording.${ext}`)

          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          })

          if (!res.ok) {
            const { error: errMsg } = await res.json()
            throw new Error(errMsg || 'Transcription failed')
          }

          const { text } = await res.json()
          if (text && text.trim()) {
            onTranscribed(text.trim())
          } else {
            setError('音声を認識できませんでした')
          }
        } catch (err) {
          console.error('Transcription error:', err)
          setError(err instanceof Error ? err.message : '文字起こしに失敗しました')
        } finally {
          setIsTranscribing(false)
        }
      }

      mediaRecorder.onerror = () => {
        setError('録音中にエラーが発生しました')
        setIsRecording(false)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Recording start error:', err)
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('マイクの使用が許可されていません。ブラウザの設定を確認してください。')
      } else {
        setError('マイクにアクセスできません')
      }
    }
  }, [onTranscribed])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }, [])

  return {
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
  }
}
