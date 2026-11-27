import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  LogIn,
  LogOut,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import type { MonthlyReport, PatrolLog } from './types';
import { getCurrentMonthKey } from './utils/media';
import { PatrolCaptureView } from './components/PatrolCaptureView';
import { PatrolLogListView } from './components/PatrolLogListView';
import { MonthlyReportView } from './components/MonthlyReportView';

type ActiveTab = 'capture' | 'logs' | 'report';

const BANNER_IMAGE_SRC = '/src/assets/images/campus_corridor_banner_1795749936164.jpg';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('capture');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());

  const [logs, setLogs] = useState<PatrolLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [reportsByMonth, setReportsByMonth] = useState<Record<string, MonthlyReport>>({});
  const [bannerImgFailed, setBannerImgFailed] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser) {
        setLogs([]);
        setReportsByMonth({});
        setLogsLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    setLogsLoading(true);

    const logsQuery = query(
      collection(db, 'patrolLogs'),
      where('ownerId', '==', user.uid)
    );

    const unsubLogs = onSnapshot(
      logsQuery,
      (snapshot) => {
        const items: PatrolLog[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || ''),
            ownerName: String(data.ownerName || ''),
            locationName: String(data.locationName || ''),
            zoneCategory: data.zoneCategory || '校園環境',
            patrolStatus: data.patrolStatus || '正常良好',
            followUpResolved: Boolean(data.followUpResolved),
            summary: String(data.summary || ''),
            observations: String(data.observations || ''),
            transcript: String(data.transcript || ''),
            actionItems: Array.isArray(data.actionItems) ? data.actionItems.map(String) : [],
            teacherOrUnit: String(data.teacherOrUnit || ''),
            photoDataUrl: String(data.photoDataUrl || ''),
            monthKey: String(data.monthKey || ''),
            patrolDateStr: String(data.patrolDateStr || ''),
            patrolTimeStr: String(data.patrolTimeStr || ''),
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
          };
        });

        items.sort((a, b) =>
          `${b.patrolDateStr} ${b.patrolTimeStr}`.localeCompare(
            `${a.patrolDateStr} ${a.patrolTimeStr}`
          )
        );
        setLogs(items);
        setLogsLoading(false);
      },
      (err) => {
        setLogsLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'patrolLogs');
      }
    );

    const reportsQuery = query(
      collection(db, 'monthlyReports'),
      where('ownerId', '==', user.uid)
    );

    const unsubReports = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const map: Record<string, MonthlyReport> = {};
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const mKey = String(data.monthKey || '');
          if (mKey) {
            map[mKey] = {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              monthKey: mKey,
              totalCount: Number(data.totalCount || 0),
              normalCount: Number(data.normalCount || 0),
              followUpCount: Number(data.followUpCount || 0),
              issueCount: Number(data.issueCount || 0),
              executiveSummary: String(data.executiveSummary || ''),
              keyHighlights: Array.isArray(data.keyHighlights) ? data.keyHighlights.map(String) : [],
              recommendations: Array.isArray(data.recommendations)
                ? data.recommendations.map(String)
                : [],
              createdAt: data.createdAt || null,
              updatedAt: data.updatedAt || null,
            };
          }
        });
        setReportsByMonth(map);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'monthlyReports');
      }
    );

    return () => {
      unsubLogs();
      unsubReports();
    };
  }, [authReady, user]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([getCurrentMonthKey()]);
    logs.forEach((l) => {
      if (l.monthKey) set.add(l.monthKey);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [logs]);

  async function handleSignIn() {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? `登入失敗：${err.message}` : '登入失敗，請允許彈出視窗後再試。'
      );
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('capture')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            巡堂紀實
          </button>

          {/* Zone 2: Concise single-line navigation links */}
          {user && (
            <nav
              aria-label="主導覽列"
              className="hidden md:flex items-center gap-7 text-sm font-medium"
            >
              <button
                type="button"
                onClick={() => setActiveTab('capture')}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'capture'
                    ? 'border-teal-700 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                快速巡堂
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'logs'
                    ? 'border-teal-700 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                紀錄列表
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('report')}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'report'
                    ? 'border-teal-700 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                每月報表
              </button>
            </nav>
          )}

          {/* Zone 3: Single primary action */}
          <div className="flex items-center shrink-0">
            {!authReady ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            ) : user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <span className="truncate max-w-[120px]">{user.displayName || user.email}</span>
                <LogOut className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 text-white text-xs sm:text-sm font-medium hover:bg-teal-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>{signingIn ? '登入中...' : 'Google 登入'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-10">
        {!authReady ? (
          <div className="py-24 flex flex-col items-center justify-center text-slate-500 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-teal-700" />
            <span className="text-sm">正在載入巡堂系統...</span>
          </div>
        ) : !user ? (
          /* Clean 2-column balanced sign-in hero */
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-6 p-7 sm:p-10 lg:p-12 flex flex-col justify-center space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-medium text-teal-700">校園巡堂紀錄與月報彙整工具</p>
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-tight [text-wrap:balance]">
                  拍照地點、口述重點，立即生成巡堂表單與月報表
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                  專為學校行政與巡堂人員設計。走動巡檢時拍下班級門牌或校園場域，開口說出觀察重點，系統自動整理成結構化紀錄並於月底彙整報表。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200/80 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">01. 拍照辨識地點</div>
                  <p className="text-xs text-slate-500 mt-1">自動辨讀班級門牌與校園區域</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">02. 口述轉成表單</div>
                  <p className="text-xs text-slate-500 mt-1">語音重點即時結構化與待辦拆解</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-900">03. 每月一鍵彙整</div>
                  <p className="text-xs text-slate-500 mt-1">支援 AI 月度總評、CSV 與列印</p>
                </div>
              </div>

              {authError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                  {authError}
                </p>
              )}

              <div>
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={signingIn}
                  className="min-h-[48px] px-6 py-3 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50 transition-colors inline-flex items-center gap-2.5"
                >
                  {signingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  <span>使用 Google 帳號登入開始巡堂</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 min-h-[260px] bg-slate-100 relative">
              {!bannerImgFailed ? (
                <img
                  src={BANNER_IMAGE_SRC}
                  alt="校園走廊日光與教室門牌實景"
                  referrerPolicy="no-referrer"
                  onError={() => setBannerImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-slate-500 bg-gradient-to-br from-slate-100 to-teal-50">
                  <Camera className="w-10 h-10 mb-2 text-teal-700/60" />
                  <span className="text-sm font-medium">校園巡堂紀錄與月報系統</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Authenticated Workspace */
          <div className="space-y-6">
            {activeTab === 'capture' && (
              <PatrolCaptureView
                user={user}
                onSavedSuccess={() => {
                  setSelectedMonth(getCurrentMonthKey());
                }}
              />
            )}

            {activeTab === 'logs' && (
              logsLoading ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 flex items-center justify-center gap-3 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin text-teal-700" />
                  <span className="text-sm">正在載入巡堂紀錄...</span>
                </div>
              ) : (
                <PatrolLogListView
                  logs={logs}
                  selectedMonth={selectedMonth === 'ALL' ? 'ALL' : selectedMonth}
                  availableMonths={availableMonths}
                  onChangeMonth={(m) => setSelectedMonth(m)}
                  onGoToCapture={() => setActiveTab('capture')}
                />
              )
            )}

            {activeTab === 'report' && (
              <MonthlyReportView
                user={user}
                logs={logs}
                selectedMonth={selectedMonth === 'ALL' ? getCurrentMonthKey() : selectedMonth}
                availableMonths={availableMonths}
                reportsByMonth={reportsByMonth}
                onChangeMonth={(m) => setSelectedMonth(m)}
                onGoToCapture={() => setActiveTab('capture')}
              />
            )}
          </div>
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation (hidden on desktop and print) */}
      {user && (
        <nav
          aria-label="行動版功能列"
          className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200"
        >
          <div className="grid grid-cols-3 h-16 items-center">
            <button
              type="button"
              onClick={() => setActiveTab('capture')}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                activeTab === 'capture' ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <Camera className="w-[22px] h-[22px]" />
              <span className="text-[11px] font-medium mt-1">快速巡堂</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                activeTab === 'logs' ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <ClipboardList className="w-[22px] h-[22px]" />
              <span className="text-[11px] font-medium mt-1">紀錄列表</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('report')}
              className={`flex flex-col items-center justify-center min-h-[44px] ${
                activeTab === 'report' ? 'text-teal-700' : 'text-slate-500'
              }`}
            >
              <FileSpreadsheet className="w-[22px] h-[22px]" />
              <span className="text-[11px] font-medium mt-1">每月報表</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
