import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  ImagePlus,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  PATROL_LIMITS,
  PATROL_STATUSES,
  ZONE_CATEGORIES,
  type PatrolDraft,
  type PatrolStatus,
  type ZoneCategory,
} from '../types';
import {
  blobToBase64,
  compressImageToJpeg,
  getCurrentTimeStr,
  getTodayDateStr,
} from '../utils/media';

interface PatrolCaptureViewProps {
  user: User;
  onSavedSuccess: () => void;
}

function createEmptyDraft(): PatrolDraft {
  return {
    locationName: '',
    zoneCategory: '教室教學',
    patrolStatus: '正常良好',
    followUpResolved: false,
    summary: '',
    observations: '',
    transcript: '',
    actionItems: [],
    teacherOrUnit: '',
    photoDataUrl: '',
    patrolDateStr: getTodayDateStr(),
    patrolTimeStr: getCurrentTimeStr(),
  };
}

export function PatrolCaptureView({ user, onSavedSuccess }: PatrolCaptureViewProps) {
  const [draft, setDraft] = useState<PatrolDraft>(createEmptyDraft);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageMimeType, setImageMimeType] = useState<string>('image/jpeg');

  // Camera live stream
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>([12, 16, 12, 18, 12, 15, 12]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Processing & Saving states
  const [noteInput, setNoteInput] = useState('');
  const [newActionItem, setNewActionItem] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  const cameraFileInputRef = useRef<HTMLInputElement | null>(null);
  const galleryFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      stopCameraStream();
      stopAudioResources();
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    };
  }, [audioPreviewUrl]);

  function stopCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  function stopAudioResources() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  async function handleStartCamera() {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('此瀏覽器不支援即時相機預覽，請使用「拍攝／上傳照片」按鈕。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch {
      setCameraError('無法開啟相機權限，您仍可透過下方按鈕拍照或選取相簿照片。');
    }
  }

  async function handleCaptureFromVideo() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    );
    stopCameraStream();
    if (blob) {
      await handleProcessPhotoBlob(blob);
    }
  }

  async function handleProcessPhotoBlob(blob: Blob) {
    setAnalyzeError(null);
    try {
      const compressed = await compressImageToJpeg(blob);
      setImageBase64(compressed.base64);
      setImageMimeType(compressed.mimeType);
      setDraft((prev) => ({ ...prev, photoDataUrl: compressed.dataUrl }));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : '照片處理失敗');
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await handleProcessPhotoBlob(file);
  }

  async function handleStartRecording() {
    setAudioError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setAudioError('此瀏覽器不支援麥克風錄音，請直接於下方輸入巡堂重點文字。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Audio level meter via Web Audio API
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        const bars = Array.from({ length: 7 }, (_, i) => {
          const val = dataArray[i * 2] || 0;
          return Math.max(12, Math.min(100, Math.round((val / 255) * 100)));
        });
        setAudioLevels(bars);
        rafRef.current = window.requestAnimationFrame(updateMeter);
      };
      updateMeter();

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supportedType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || supportedType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
        const nextUrl = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioPreviewUrl(nextUrl);
        stopAudioResources();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setAudioError('無法取得麥克風權限，請確認瀏覽器麥克風授權或直接輸入文字。');
    }
  }

  function handleStopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function handleClearAudio() {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioBlob(null);
    setAudioPreviewUrl(null);
    setRecordSeconds(0);
  }

  async function handleAnalyzeWithAi() {
    setAnalyzeError(null);
    setSavedBanner(false);

    if (!imageBase64 && !audioBlob && !noteInput.trim()) {
      setAnalyzeError('請先拍攝現場照片，並口述錄音或輸入巡堂重點。');
      return;
    }

    setIsAnalyzing(true);
    try {
      let audioBase64: string | undefined;
      let audioMimeType: string | undefined;

      if (audioBlob) {
        audioBase64 = await blobToBase64(audioBlob);
        audioMimeType = audioBlob.type || 'audio/webm';
      }

      const res = await fetch('/api/patrol/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageBase64 || undefined,
          imageMimeType: imageBase64 ? imageMimeType : undefined,
          audioBase64,
          audioMimeType,
          noteText: noteInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI 辨識分析失敗，請稍後再試。');
      }

      const s = data.structured;
      setDraft((prev) => ({
        ...prev,
        locationName: s.locationName || prev.locationName,
        zoneCategory: ZONE_CATEGORIES.includes(s.zoneCategory) ? s.zoneCategory : prev.zoneCategory,
        patrolStatus: PATROL_STATUSES.includes(s.patrolStatus) ? s.patrolStatus : prev.patrolStatus,
        followUpResolved: s.patrolStatus === '正常良好',
        summary: s.summary || prev.summary,
        observations: s.observations || prev.observations,
        transcript: data.transcript || prev.transcript,
        actionItems: Array.isArray(s.actionItems) ? s.actionItems : prev.actionItems,
        teacherOrUnit: s.teacherOrUnit || prev.teacherOrUnit,
        patrolDateStr: getTodayDateStr(),
        patrolTimeStr: getCurrentTimeStr(),
      }));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : '分析失敗，請稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleAddActionItem() {
    const trimmed = newActionItem.trim();
    if (!trimmed) return;
    if (draft.actionItems.length >= PATROL_LIMITS.actionItemsMaxCount) return;
    setDraft((prev) => ({
      ...prev,
      actionItems: [...prev.actionItems, trimmed.slice(0, PATROL_LIMITS.actionItemMaxLen)],
    }));
    setNewActionItem('');
  }

  function handleRemoveActionItem(idx: number) {
    setDraft((prev) => ({
      ...prev,
      actionItems: prev.actionItems.filter((_, i) => i !== idx),
    }));
  }

  async function handleSavePatrolLog(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSavedBanner(false);

    const locationName = draft.locationName.trim().slice(0, PATROL_LIMITS.locationNameMax);
    const summary = draft.summary.trim().slice(0, PATROL_LIMITS.summaryMax);

    if (!locationName) {
      setSaveError('請填寫巡堂地點或班級名稱。');
      return;
    }
    if (!summary) {
      setSaveError('請填寫巡堂重點摘要。');
      return;
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const timePattern = /^\d{2}:\d{2}$/;
    const patrolDateStr = datePattern.test(draft.patrolDateStr)
      ? draft.patrolDateStr
      : getTodayDateStr();
    const patrolTimeStr = timePattern.test(draft.patrolTimeStr)
      ? draft.patrolTimeStr
      : getCurrentTimeStr();
    const monthKey = patrolDateStr.slice(0, 7);

    const payload = {
      ownerId: user.uid,
      ownerName: (user.displayName || user.email || '巡堂人員').slice(0, PATROL_LIMITS.ownerNameMax),
      locationName,
      zoneCategory: draft.zoneCategory,
      patrolStatus: draft.patrolStatus,
      followUpResolved: draft.patrolStatus === '正常良好' ? true : draft.followUpResolved,
      summary,
      observations: draft.observations.trim().slice(0, PATROL_LIMITS.observationsMax),
      transcript: draft.transcript.trim().slice(0, PATROL_LIMITS.transcriptMax),
      actionItems: draft.actionItems
        .map((item) => item.trim().slice(0, PATROL_LIMITS.actionItemMaxLen))
        .filter(Boolean)
        .slice(0, PATROL_LIMITS.actionItemsMaxCount),
      teacherOrUnit: draft.teacherOrUnit.trim().slice(0, PATROL_LIMITS.teacherOrUnitMax),
      photoDataUrl: draft.photoDataUrl.slice(0, PATROL_LIMITS.photoDataUrlMax),
      monthKey,
      patrolDateStr,
      patrolTimeStr,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'patrolLogs'), payload);
      setDraft(createEmptyDraft());
      setImageBase64('');
      setNoteInput('');
      handleClearAudio();
      setSavedBanner(true);
      onSavedSuccess();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'patrolLogs');
    } finally {
      setIsSaving(false);
    }
  }

  function handleResetAll() {
    stopCameraStream();
    if (isRecording) handleStopRecording();
    handleClearAudio();
    setDraft(createEmptyDraft());
    setImageBase64('');
    setNoteInput('');
    setAnalyzeError(null);
    setSaveError(null);
    setSavedBanner(false);
  }

  const formattedTimer = `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(
    recordSeconds % 60
  ).padStart(2, '0')}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Column: Photo + Voice Dictation */}
      <section className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">1. 現場拍照與口述紀錄</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                拍攝班級門牌或校園場域，並以語音口述巡堂重點
              </p>
            </div>
            {(draft.photoDataUrl || audioBlob || noteInput) && (
              <button
                type="button"
                onClick={handleResetAll}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重設</span>
              </button>
            )}
          </div>

          {/* Photo Capture Frame */}
          <div className="space-y-3">
            <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
              {cameraOpen ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3 px-4">
                    <button
                      type="button"
                      onClick={handleCaptureFromVideo}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-medium shadow-md hover:bg-teal-800 active:scale-[0.98] transition-all min-h-[44px] whitespace-nowrap"
                    >
                      <Camera className="w-4 h-4" />
                      <span>拍攝照片</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/95 text-slate-800 text-sm font-medium border border-slate-200 hover:bg-white min-h-[44px] whitespace-nowrap"
                    >
                      <X className="w-4 h-4" />
                      <span>關閉</span>
                    </button>
                  </div>
                </>
              ) : draft.photoDataUrl ? (
                <>
                  <img
                    src={draft.photoDataUrl}
                    alt="巡堂現場照片"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((prev) => ({ ...prev, photoDataUrl: '' }));
                      setImageBase64('');
                    }}
                    aria-label="移除照片"
                    className="absolute top-3 right-3 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-slate-900/75 text-white hover:bg-slate-900 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="text-center px-6 py-8">
                  <div className="w-12 h-12 rounded-xl bg-slate-200/80 text-slate-600 flex items-center justify-center mx-auto mb-3">
                    <Camera className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-slate-800">尚未拍攝現場照片</p>
                  <p className="text-xs text-slate-500 mt-1">
                    可拍攝教室門牌、教學情形、走廊或安全設施
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {cameraError}
              </p>
            )}

            <input
              ref={cameraFileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelected}
              className="hidden"
            />
            <input
              ref={galleryFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelected}
              className="hidden"
            />

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => cameraFileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-xs sm:text-sm font-medium hover:bg-slate-800 transition-colors min-h-[44px] whitespace-nowrap"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>拍照</span>
              </button>
              <button
                type="button"
                onClick={handleStartCamera}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 transition-colors min-h-[44px] whitespace-nowrap"
              >
                <Video className="w-4 h-4 shrink-0" />
                <span>即時取景</span>
              </button>
              <button
                type="button"
                onClick={() => galleryFileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-50 transition-colors min-h-[44px] whitespace-nowrap"
              >
                <ImagePlus className="w-4 h-4 shrink-0" />
                <span>相簿選取</span>
              </button>
            </div>
          </div>

          <hr className="border-slate-200/80" />

          {/* Voice Dictation Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800">語音口述巡堂重點</span>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {isRecording ? `錄音中 ${formattedTimer}` : audioBlob ? `已錄製 ${formattedTimer}` : '待命'}
              </span>
            </div>

            {!isRecording ? (
              <button
                type="button"
                onClick={handleStartRecording}
                className="w-full min-h-[52px] px-4 py-3 rounded-xl border border-teal-700/20 bg-teal-50/70 text-teal-900 hover:bg-teal-100/70 transition-colors flex items-center justify-center gap-2.5 text-sm font-semibold active:scale-[0.99]"
              >
                <Mic className="w-5 h-5 text-teal-700 shrink-0" />
                <span>{audioBlob ? '重新口述錄音' : '點擊開始語音口述'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopRecording}
                className="w-full min-h-[52px] px-4 py-3 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-between gap-3 text-sm font-semibold"
              >
                <span className="inline-flex items-center gap-2">
                  <Square className="w-4 h-4 fill-current shrink-0" />
                  <span>停止錄音</span>
                </span>
                <span className="flex items-center gap-1 h-5" aria-hidden="true">
                  {audioLevels.map((lv, idx) => (
                    <span
                      key={idx}
                      className="w-1 bg-white/90 rounded-full transition-all duration-75"
                      style={{ height: `${Math.max(20, lv)}%` }}
                    />
                  ))}
                </span>
                <span className="font-mono tabular-nums text-xs">{formattedTimer}</span>
              </button>
            )}

            {audioError && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {audioError}
              </p>
            )}

            {audioPreviewUrl && !isRecording && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                <audio src={audioPreviewUrl} controls className="w-full h-9" />
                <button
                  type="button"
                  onClick={handleClearAudio}
                  aria-label="刪除錄音"
                  className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            <div>
              <label htmlFor="patrol-note-input" className="block text-xs font-medium text-slate-600 mb-1.5">
                文字補充或直接輸入內容（選填）
              </label>
              <textarea
                id="patrol-note-input"
                rows={3}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="例如：五年甲班上課秩序良好，但靠窗第二盞日光燈閃爍，請總務處協助更換。"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>
          </div>

          {analyzeError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{analyzeError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={isAnalyzing || isRecording}
            onClick={handleAnalyzeWithAi}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在辨識地點與整理巡堂表單...</span>
              </>
            ) : (
              <span>AI 辨識並自動填入巡堂表單</span>
            )}
          </button>
        </div>
      </section>

      {/* Right Column: Structured Patrol Record Form */}
      <section className="lg:col-span-7">
        <form
          onSubmit={handleSavePatrolLog}
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">2. 巡堂紀錄表單確認</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                核對或微調以下欄位後即可儲存至本月報表
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
              <span>{draft.patrolDateStr}</span>
              <span aria-hidden="true">·</span>
              <span>{draft.patrolTimeStr}</span>
            </div>
          </div>

          {savedBanner && (
            <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-900">
              <span className="inline-flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>巡堂紀錄已成功儲存並納入本月彙整！</span>
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="location-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                巡堂地點／班級名稱 <span className="text-red-600">*</span>
              </label>
              <input
                id="location-name"
                type="text"
                required
                maxLength={PATROL_LIMITS.locationNameMax}
                value={draft.locationName}
                onChange={(e) => setDraft((prev) => ({ ...prev, locationName: e.target.value }))}
                placeholder="例：三年二班教室、操場東側"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label htmlFor="teacher-unit" className="block text-xs font-medium text-slate-700 mb-1.5">
                相關班級／權責處室
              </label>
              <input
                id="teacher-unit"
                type="text"
                maxLength={PATROL_LIMITS.teacherOrUnitMax}
                value={draft.teacherOrUnit}
                onChange={(e) => setDraft((prev) => ({ ...prev, teacherOrUnit: e.target.value }))}
                placeholder="例：總務處、教務處、三年二班"
                className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
              />
            </div>
          </div>

          {/* Zone Category Segmented Buttons */}
          <div>
            <span className="block text-xs font-medium text-slate-700 mb-2">巡檢區域類別</span>
            <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
              {ZONE_CATEGORIES.map((zone: ZoneCategory) => {
                const active = draft.zoneCategory === zone;
                return (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, zoneCategory: zone }))}
                    className={`flex-1 min-w-[84px] min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {zone}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Patrol Status Segmented Buttons (Icon + Text, never hue-only) */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-7">
              <span className="block text-xs font-medium text-slate-700 mb-2">巡堂狀況判定</span>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                {PATROL_STATUSES.map((status: PatrolStatus) => {
                  const active = draft.patrolStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          patrolStatus: status,
                          followUpResolved: status === '正常良好' ? true : false,
                        }))
                      }
                      className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                        active
                          ? status === '正常良好'
                            ? 'bg-white text-emerald-700 shadow-sm'
                            : status === '需追蹤提醒'
                              ? 'bg-white text-amber-700 shadow-sm'
                              : 'bg-white text-red-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {status === '正常良好' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                      {status === '需追蹤提醒' && <Clock className="w-3.5 h-3.5 shrink-0" />}
                      {status === '異常待修' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                      <span>{status}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sm:col-span-5 grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="patrol-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                  巡堂日期
                </label>
                <input
                  id="patrol-date"
                  type="date"
                  value={draft.patrolDateStr}
                  onChange={(e) => setDraft((prev) => ({ ...prev, patrolDateStr: e.target.value }))}
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label htmlFor="patrol-time" className="block text-xs font-medium text-slate-700 mb-1.5">
                  時間
                </label>
                <input
                  id="patrol-time"
                  type="time"
                  value={draft.patrolTimeStr}
                  onChange={(e) => setDraft((prev) => ({ ...prev, patrolTimeStr: e.target.value }))}
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="patrol-summary" className="block text-xs font-medium text-slate-700 mb-1.5">
              巡堂重點摘要 <span className="text-red-600">*</span>
            </label>
            <textarea
              id="patrol-summary"
              required
              rows={2}
              maxLength={PATROL_LIMITS.summaryMax}
              value={draft.summary}
              onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
              placeholder="一句話摘要本次巡堂重點與發現..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>

          <div>
            <label htmlFor="patrol-observations" className="block text-xs font-medium text-slate-700 mb-1.5">
              現場觀察紀錄
            </label>
            <textarea
              id="patrol-observations"
              rows={3}
              maxLength={PATROL_LIMITS.observationsMax}
              value={draft.observations}
              onChange={(e) => setDraft((prev) => ({ ...prev, observations: e.target.value }))}
              placeholder="詳細描述課堂教學、環境清潔或安全設施現況..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
            />
          </div>

          {/* Action Items List */}
          <div className="space-y-2.5">
            <span className="block text-xs font-medium text-slate-700">
              待辦／建議追蹤事項（最多 {PATROL_LIMITS.actionItemsMaxCount} 項）
            </span>

            {draft.actionItems.length > 0 && (
              <ul className="space-y-2">
                {draft.actionItems.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                  >
                    <span className="leading-snug">
                      <span className="font-mono tabular-nums text-xs text-slate-400 mr-2">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveActionItem(idx)}
                      aria-label="刪除待辦事項"
                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                maxLength={PATROL_LIMITS.actionItemMaxLen}
                value={newActionItem}
                onChange={(e) => setNewActionItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddActionItem();
                  }
                }}
                placeholder="新增追蹤或報修建議項目..."
                className="flex-1 min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-700"
              />
              <button
                type="button"
                onClick={handleAddActionItem}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>加入</span>
              </button>
            </div>
          </div>

          {draft.transcript && (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5">
              <div className="text-xs font-medium text-slate-500 mb-1">口述語音轉錄逐字稿</div>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {draft.transcript}
              </p>
            </div>
          )}

          {saveError && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-[48px] px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>儲存中...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>儲存巡堂紀錄</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
