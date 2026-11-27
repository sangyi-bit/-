import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let displayMessage = error.message || '系統發生未預期的錯誤。';
    try {
      const parsed = JSON.parse(displayMessage);
      if (parsed && typeof parsed.error === 'string') {
        displayMessage = `資料存取發生錯誤（${parsed.operationType || 'unknown'}）：${parsed.error}`;
      }
    } catch {
      // Not JSON, keep original message
    }
    return { hasError: true, message: displayMessage };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-8">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold text-slate-900">系統載入異常</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors min-h-[44px]"
            >
              <RotateCcw className="w-4 h-4" />
              <span>重新整理頁面</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
