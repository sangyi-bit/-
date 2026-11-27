import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  PATROL_LIMITS,
  ZONE_CATEGORIES,
  type MonthlyReport,
  type PatrolLog,
} from '../types';
import { exportMonthlyCsv, formatMonthLabel } from '../utils/media';

interface MonthlyReportViewProps {
  user: User;
  logs: PatrolLog[];
  selectedMonth: string;
  availableMonths: string[];
  reportsByMonth: Record<string, MonthlyReport>;
  onChangeMonth: (month: string) => void;
  onGoToCapture: () => void;
}

export function MonthlyReportView({
  user,
  logs,
  selectedMonth,
  availableMonths,
  reportsByMonth,
  onChangeMonth,
  onGoToCapture,
}: MonthlyReportViewProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const monthLogs = useMemo(
    () =>
      logs
        .filter((l) => l.monthKey === selectedMonth)
        .sort((a, b) =>
          `${a.patrolDateStr} ${a.patrolTimeStr}`.localeCompare(
            `${b.patrolDateStr} ${b.patrolTimeStr}`
          )
        ),
    [logs, selectedMonth]
  );

  const stats = useMemo(() => {
    const total = monthLogs.length;
    const normal = monthLogs.filter((l) => l.patrolStatus === '正常良好').length;
    const followUp = monthLogs.filter((l) => l.patrolStatus === '需追蹤提醒').length;
    const issue = monthLogs.filter((l) => l.patrolStatus === '異常待修').length;
    const pendingFollowUps = monthLogs.filter(
      (l) => l.patrolStatus !== '正常良好' && !l.followUpResolved
    );

    const byZone = ZONE_CATEGORIES.map((zone) => {
      const count = monthLogs.filter((l) => l.zoneCategory === zone).length;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return { zone, count, pct };
    });

    return { total, normal, followUp, issue, pendingFollowUps, byZone };
  }, [monthLogs]);

  const currentReport = reportsByMonth[selectedMonth] || null;

  async function handleGenerateMonthlyReport() {
    if (monthLogs.length === 0) return;
    setGenError(null);
    setIsGenerating(true);
    try {
      const res = await fetch('/api/patrol/monthly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthKey: selectedMonth,
          logs: monthLogs.map((l) => ({
            locationName: l.locationName,
            zoneCategory: l.zoneCategory,
            patrolStatus: l.patrolStatus,
            followUpResolved: l.followUpResolved,
            summary: l.summary,
            observations: l.observations,
            actionItems: l.actionItems,
            teacherOrUnit: l.teacherOrUnit,
            patrolDateStr: l.patrolDateStr,
            patrolTimeStr: l.patrolTimeStr,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '無法生成月度彙整分析');
      }

      const reportId = `${user.uid}_${selectedMonth}`;
      const docRef = doc(db, 'monthlyReports', reportId);

      const commonFields = {
        totalCount: stats.total,
        normalCount: stats.normal,
        followUpCount: stats.followUp,
        issueCount: stats.issue,
        executiveSummary: String(data.executiveSummary || '').slice(
          0,
          PATROL_LIMITS.executiveSummaryMax
        ),
        keyHighlights: Array.isArray(data.keyHighlights)
          ? data.keyHighlights
              .slice(0, PATROL_LIMITS.reportListMaxCount)
              .map((s: unknown) => String(s).slice(0, PATROL_LIMITS.reportListItemMaxLen))
          : [],
        recommendations: Array.isArray(data.recommendations)
          ? data.recommendations
              .slice(0, PATROL_LIMITS.reportListMaxCount)
              .map((s: unknown) => String(s).slice(0, PATROL_LIMITS.reportListItemMaxLen))
          : [],
        updatedAt: serverTimestamp(),
      };

      try {
        if (currentReport) {
          await updateDoc(docRef, commonFields);
        } else {
          await setDoc(docRef, {
            ownerId: user.uid,
            monthKey: selectedMonth,
            ...commonFields,
            createdAt: serverTimestamp(),
          });
        }
      } catch (fsErr) {
        handleFirestoreError(
          fsErr,
          currentReport ? OperationType.UPDATE : OperationType.CREATE,
          `monthlyReports/${reportId}`
        );
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : '月報彙整生成失敗');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar (hidden on print) */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="report-month-select" className="text-sm font-medium text-slate-700">
            報表月份
          </label>
          <select
            id="report-month-select"
            value={selectedMonth}
            onChange={(e) => onChangeMonth(e.target.value)}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:border-teal-700"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={monthLogs.length === 0 || isGenerating}
            onClick={handleGenerateMonthlyReport}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>AI 彙整生成中...</span>
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                <span>{currentReport ? '更新 AI 月度彙整分析' : 'AI 生成月度彙整分析'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={monthLogs.length === 0}
            onClick={() => exportMonthlyCsv(selectedMonth, monthLogs)}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>匯出 CSV</span>
          </button>

          <button
            type="button"
            disabled={monthLogs.length === 0}
            onClick={() => window.print()}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>列印／另存 PDF</span>
          </button>
        </div>
      </div>

      {genError && (
        <div className="no-print flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{genError}</span>
        </div>
      )}

      {monthLogs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <p className="text-base font-semibold text-slate-900">
            {formatMonthLabel(selectedMonth)} 尚無巡堂紀錄
          </p>
          <p className="text-sm text-slate-500 mt-1.5 mb-6">
            完成巡堂拍照與口述建檔後，即可於此頁一鍵彙整成月報表
          </p>
          <button
            type="button"
            onClick={onGoToCapture}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors min-h-[44px]"
          >
            <Camera className="w-4 h-4" />
            <span>前往建立巡堂紀錄</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Official Printable Report Header */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <p className="text-xs font-medium text-slate-500">校園行政巡檢月度彙整報表</p>
                <h2 className="text-2xl font-bold text-slate-900 mt-1">
                  {formatMonthLabel(selectedMonth)} 巡堂紀錄彙整報告
                </h2>
              </div>
              <div className="text-xs text-slate-500 space-y-1 sm:text-right font-mono tabular-nums">
                <div>巡堂人員：{user.displayName || user.email}</div>
                <div>統計區間：{selectedMonth}</div>
              </div>
            </div>

            {/* 4-column Tabular KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">本月巡堂總次數</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {stats.total} <span className="text-xs font-normal text-slate-500">筆</span>
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>正常良好</span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {stats.normal} <span className="text-xs font-normal text-slate-500">筆</span>
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-amber-700 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>需追蹤提醒</span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {stats.followUp} <span className="text-xs font-normal text-slate-500">筆</span>
                </div>
              </div>
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-red-700 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>異常待修</span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {stats.issue}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    筆（未結案 {stats.pendingFollowUps.length}）
                  </span>
                </div>
              </div>
            </div>

            {/* Zone Breakdown */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">各巡檢區域分布統計</h3>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {stats.byZone.map((z) => (
                  <div key={z.zone} className="border border-slate-200/90 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{z.zone}</span>
                      <span className="font-mono tabular-nums text-slate-500">{z.count} 筆</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-700 rounded-full"
                        style={{ width: `${z.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Synthesized Executive Summary */}
            {currentReport ? (
              <div className="border-t border-slate-200 pt-6 space-y-5 print-break-inside-avoid">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">月度巡檢總結與建議</h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    依 {currentReport.totalCount} 筆紀錄彙整
                  </span>
                </div>

                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {currentReport.executiveSummary}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-900">本月重要觀察亮點</h4>
                    <ul className="space-y-2 text-sm text-slate-700">
                      {currentReport.keyHighlights.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="font-mono tabular-nums text-xs text-slate-400 mt-1">
                            {String(i + 1).padStart(2, '0')}.
                          </span>
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-900">待辦追蹤與下月建議</h4>
                    <ul className="space-y-2 text-sm text-slate-700">
                      {currentReport.recommendations.map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="font-mono tabular-nums text-xs text-slate-400 mt-1">
                            {String(i + 1).padStart(2, '0')}.
                          </span>
                          <span className="leading-relaxed">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="no-print border-t border-slate-200 pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  點擊右上角「AI 生成月度彙整分析」，可自動統整本月各班級與校園區域之總評與改善建議。
                </p>
              </div>
            )}
          </div>

          {/* Complete Chronological Patrol Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">本月巡堂紀錄明細表</h3>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                共 {monthLogs.length} 筆
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">日期／時間</th>
                    <th className="py-3 px-4 whitespace-nowrap">現場照片</th>
                    <th className="py-3 px-4 whitespace-nowrap">地點／班級</th>
                    <th className="py-3 px-4 whitespace-nowrap">類別與狀況</th>
                    <th className="py-3 px-4 min-w-[240px]">巡堂重點與待辦事項</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {monthLogs.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-slate-50/70 print-break-inside-avoid">
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        <div>{log.patrolDateStr}</div>
                        <div className="text-slate-400 mt-0.5">{log.patrolTimeStr}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="w-20 h-15 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                          {log.photoDataUrl ? (
                            <img
                              src={log.photoDataUrl}
                              alt={log.locationName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Camera className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{log.locationName}</div>
                        {log.teacherOrUnit && log.teacherOrUnit !== '無' && (
                          <div className="text-xs text-slate-500 mt-0.5">{log.teacherOrUnit}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-xs text-slate-600">{log.zoneCategory}</div>
                        <div
                          className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${
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
                        </div>
                        {log.patrolStatus !== '正常良好' && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {log.followUpResolved ? '已結案' : '待處理'}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 space-y-1.5">
                        <div className="text-slate-900 font-medium leading-snug">{log.summary}</div>
                        {log.observations && (
                          <div className="text-xs text-slate-600 leading-relaxed">
                            {log.observations}
                          </div>
                        )}
                        {log.actionItems.length > 0 && (
                          <ul className="text-xs text-slate-700 space-y-0.5 pt-1">
                            {log.actionItems.map((act, idx) => (
                              <li key={idx}>• {act}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
