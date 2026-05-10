"use client"

import { useState, useRef, useCallback } from "react"

interface UseVoiceRecorderReturn {
  isRecording: boolean
  isTranscribing: boolean
  error: string | null
  permissionState: PermissionState | "unsupported" | null
  analyserRef: React.RefObject<AnalyserNode | null>
  startRecording: () => Promise<void>
  stopRecording: () => void
}

export function useVoiceRecorder(
  onTranscribed: (text: string) => void
): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionState, setPermissionState] = useState<PermissionState | "unsupported" | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const refreshPermissionState = useCallback(async () => {
    if (!navigator.permissions?.query) return
    try {
      const status = await navigator.permissions.query({ name: "microphone" as PermissionName })
      setPermissionState(status.state)
      status.onchange = () => setPermissionState(status.state)
    } catch {
      setPermissionState(null)
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError(null)

    try {
      await refreshPermissionState()
      if (!window.isSecureContext) {
        setPermissionState("unsupported")
        setError("マイクはHTTPSまたはlocalhostでのみ使えます。localhostで開き直してください。")
        return
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setPermissionState("unsupported")
        setError("このブラウザでは音声録音に対応していません。Arc/Chrome/Safariで開いてください。")
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setPermissionState("granted")

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

      // AudioContext + AnalyserNode で波形データを取得
      try {
        const audioContext = new AudioContext()
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.7
        source.connect(analyser)
        audioContextRef.current = audioContext
        analyserRef.current = analyser
      } catch {
        // AudioContext が使えなくても録音自体は続行
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Recording start error:', err)
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setPermissionState("denied")
          setError('マイクの使用が拒否されています。「設定を開く」から、このブラウザまたはCodexを許可してからページを再読み込みしてください。')
          return
        }
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('利用できるマイクが見つかりません。入力デバイスの接続を確認してください。')
          return
        }
        if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setError('マイクを開始できません。他のアプリがマイクを使用している可能性があります。')
          return
        }
      }
      setError('マイクにアクセスできません')
    }
  }, [onTranscribed, refreshPermissionState])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
    // AudioContext クリーンアップ
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
      analyserRef.current = null
    }
  }, [])

  return {
    isRecording,
    isTranscribing,
    error,
    permissionState,
    analyserRef,
    startRecording,
    stopRecording,
  }
}
