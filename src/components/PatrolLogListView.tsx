import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  PATROL_LIMITS,
  PATROL_STATUSES,
  ZONE_CATEGORIES,
  type PatrolLog,
  type PatrolStatus,
  type ZoneCategory,
} from '../types';
import { formatMonthLabel } from '../utils/media';

interface PatrolLogListViewProps {
  logs: PatrolLog[];
  selectedMonth: string;
  availableMonths: string[];
  onChangeMonth: (month: string) => void;
  onGoToCapture: () => void;
}

export function PatrolLogListView({
  logs,
  selectedMonth,
  availableMonths,
  onChangeMonth,
  onGoToCapture,
}: PatrolLogListViewProps) {
  const [statusFilter, setStatusFilter] = useState<'全部' | PatrolStatus>('全部');
  const [zoneFilter, setZoneFilter] = useState<'全部' | ZoneCategory>('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<PatrolLog | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (selectedMonth !== 'ALL' && log.monthKey !== selectedMonth) return false;
      if (statusFilter !== '全部' && log.patrolStatus !== statusFilter) return false;
      if (zoneFilter !== '全部' && log.zoneCategory !== zoneFilter) return false;
      if (q) {
        const hay = `${log.locationName} ${log.summary} ${log.observations} ${log.teacherOrUnit}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, selectedMonth, statusFilter, zoneFilter, searchQuery]);

  async function handleToggleResolved(log: PatrolLog) {
    try {
      await updateDoc(doc(db, 'patrolLogs', log.id), {
        followUpResolved: !log.followUpResolved,
        patrolStatus: log.patrolStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `patrolLogs/${log.id}`);
    }
  }

  async function handleDelete(logId: string) {
    try {
      await deleteDoc(doc(db, 'patrolLogs', logId));
      setConfirmDeleteId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `patrolLogs/${logId}`);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLog) return;
    setEditSaving(true);
    try {
      const monthKey = editingLog.patrolDateStr.slice(0, 7);
      await updateDoc(doc(db, 'patrolLogs', editingLog.id), {
        locationName: editingLog.locationName.trim().slice(0, PATROL_LIMITS.locationNameMax),
        zoneCategory: editingLog.zoneCategory,
        patrolStatus: editingLog.patrolStatus,
        followUpResolved: editingLog.followUpResolved,
        summary: editingLog.summary.trim().slice(0, PATROL_LIMITS.summaryMax),
        observations: editingLog.observations.trim().slice(0, PATROL_LIMITS.observationsMax),
        transcript: editingLog.transcript.slice(0, PATROL_LIMITS.transcriptMax),
        actionItems: editingLog.actionItems
          .map((i) => i.trim().slice(0, PATROL_LIMITS.actionItemMaxLen))
          .filter(Boolean)
          .slice(0, PATROL_LIMITS.actionItemsMaxCount),
        teacherOrUnit: editingLog.teacherOrUnit.trim().slice(0, PATROL_LIMITS.teacherOrUnitMax),
        photoDataUrl: editingLog.photoDataUrl,
        monthKey,
        patrolDateStr: editingLog.patrolDateStr,
        patrolTimeStr: editingLog.patrolTimeStr,
        updatedAt: serverTimestamp(),
      });
      setEditingLog(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `patrolLogs/${editingLog.id}`);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="篩選月份"
              value={selectedMonth}
              onChange={(e) => onChangeMonth(e.target.value)}
              className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-teal-700"
            >
              <option value="ALL">所有月份</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>

            <select
              aria-label="篩選類別"
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value as '全部' | ZoneCategory)}
              className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:border-teal-700"
            >
              <option value="全部">全部區域類別</option>
              {ZONE_CATEGORIES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋地點、班級或重點關鍵字..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
            />
          </div>
        </div>

        {/* Status Segmented Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {(['全部', ...PATROL_STATUSES] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            顯示 {filteredLogs.length} 筆紀錄
          </span>
        </div>
      </div>

      {/* Empty State vs List */}
      {filteredLogs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <p className="text-base font-semibold text-slate-900">目前沒有符合條件的巡堂紀錄</p>
          <p className="text-sm text-slate-500 mt-1.5 mb-6">
            點擊下方按鈕開始拍照與語音口述，快速建立第一筆巡堂表單
          </p>
          <button
            type="button"
            onClick={onGoToCapture}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors min-h-[44px]"
          >
            <Camera className="w-4 h-4" />
            <span>立即新增巡堂紀錄</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredLogs.map((log) => (
            <article
              key={log.id}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
            >
              <div className="flex flex-col sm:flex-row gap-4 p-5">
                {/* Thumbnail with zero-broken-image fallback */}
                <div className="sm:w-36 sm:h-28 aspect-[4/3] sm:aspect-auto rounded-xl overflow-hidden bg-slate-100 border border-slate-200/80 shrink-0 flex items-center justify-center">
                  {log.photoDataUrl ? (
                    <img
                      src={log.photoDataUrl}
                      alt={log.locationName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-3 text-slate-400">
                      <Camera className="w-6 h-6 mx-auto mb-1" />
                      <span className="text-[11px] block">無照片</span>
                    </div>
                  )}
                </div>

                {/* Primary Content */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Quiet unboxed metadata line */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{log.zoneCategory}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {log.patrolDateStr} {log.patrolTimeStr}
                    </span>
                    {log.teacherOrUnit && log.teacherOrUnit !== '無' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[140px]">{log.teacherOrUnit}</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900 leading-snug">
                      {log.locationName}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                        log.patrolStatus === '正常良好'
                          ? 'text-emerald-700'
                          : log.patrolStatus === '需追蹤提醒'
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }`}
                    >
                      {log.patrolStatus === '正常良好' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {log.patrolStatus === '需追蹤提醒' && <Clock className="w-3.5 h-3.5" />}
                      {log.patrolStatus === '異常待修' && <AlertTriangle className="w-3.5 h-3.5" />}
                      <span>{log.patrolStatus}</span>
                    </span>
                  </div>

                  <p className="text-sm text-slate-700 leading-relaxed">{log.summary}</p>
                </div>
              </div>

              {(log.observations || log.actionItems.length > 0) && (
                <div className="px-5 pb-4 pt-0 space-y-2 text-xs text-slate-600">
                  {log.observations && (
                    <p className="leading-relaxed border-t border-slate-100 pt-3">
                      {log.observations}
                    </p>
                  )}
                  {log.actionItems.length > 0 && (
                    <ul className="space-y-1 pt-1">
                      {log.actionItems.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-700">
                          <span className="font-mono tabular-nums text-slate-400">
                            {idx + 1}.
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Footer Actions */}
              <div className="mt-auto px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between gap-2">
                {log.patrolStatus !== '正常良好' ? (
                  <button
                    type="button"
                    onClick={() => handleToggleResolved(log)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      log.followUpResolved
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{log.followUpResolved ? '已追蹤結案' : '標記為已結案'}</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">無需追蹤事項</span>
                )}

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingLog({ ...log })}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>編輯</span>
                  </button>

                  {confirmDeleteId === log.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(log.id)}
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
                      >
                        確認刪除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[38px] px-2 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(log.id)}
                      aria-label="刪除紀錄"
                      className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingLog && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveEdit}
            className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">編輯巡堂紀錄</h3>
              <button
                type="button"
                onClick={() => setEditingLog(null)}
                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">地點／班級</label>
                <input
                  type="text"
                  required
                  value={editingLog.locationName}
                  onChange={(e) =>
                    setEditingLog({ ...editingLog, locationName: e.target.value })
                  }
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">相關單位／班級</label>
                <input
                  type="text"
                  value={editingLog.teacherOrUnit}
                  onChange={(e) =>
                    setEditingLog({ ...editingLog, teacherOrUnit: e.target.value })
                  }
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">類別</label>
                <select
                  value={editingLog.zoneCategory}
                  onChange={(e) =>
                    setEditingLog({ ...editingLog, zoneCategory: e.target.value as ZoneCategory })
                  }
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {ZONE_CATEGORIES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">狀況</label>
                <select
                  value={editingLog.patrolStatus}
                  onChange={(e) =>
                    setEditingLog({ ...editingLog, patrolStatus: e.target.value as PatrolStatus })
                  }
                  className="w-full min-h-[42px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {PATROL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">重點摘要</label>
              <textarea
                rows={2}
                required
                value={editingLog.summary}
                onChange={(e) => setEditingLog({ ...editingLog, summary: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">現場觀察紀錄</label>
              <textarea
                rows={3}
                value={editingLog.observations}
                onChange={(e) => setEditingLog({ ...editingLog, observations: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingLog(null)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                {editSaving ? '儲存中...' : '儲存變更'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
