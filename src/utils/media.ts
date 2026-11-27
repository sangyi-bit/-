import { PATROL_LIMITS, type PatrolLog } from '../types';

export interface CompressedImageResult {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

export async function compressImageToJpeg(fileOrBlob: Blob): Promise<CompressedImageResult> {
  const bitmapUrl = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('無法讀取照片檔案，請重試。'));
      image.src = bitmapUrl;
    });

    const maxDim = 960;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('瀏覽器不支援畫布壓縮。');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.72;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > PATROL_LIMITS.photoDataUrlMax - 5000 && quality > 0.3) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > PATROL_LIMITS.photoDataUrlMax) {
      throw new Error('照片檔案過大，請嘗試重新拍攝或縮小解析度。');
    }

    const base64 = dataUrl.split(',')[1] || '';
    return {
      dataUrl,
      base64,
      mimeType: 'image/jpeg',
    };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('無法讀取錄音檔案。'));
    reader.readAsDataURL(blob);
  });
}

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeStr(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  if (!y || !m) return monthKey;
  return `${y} 年 ${Number(m)} 月`;
}

function escapeCsvCell(val: string): string {
  const safe = val.replace(/\r\n|\r|\n/g, ' ');
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportMonthlyCsv(monthKey: string, logs: PatrolLog[]): void {
  const headers = [
    '巡堂日期',
    '時間',
    '地點／班級',
    '區域類別',
    '巡堂狀況',
    '追蹤結案',
    '相關單位／教師',
    '巡堂重點摘要',
    '現場觀察紀錄',
    '待辦／建議事項',
    '巡堂人員',
  ];

  const rows = logs.map((log) => [
    log.patrolDateStr,
    log.patrolTimeStr,
    log.locationName,
    log.zoneCategory,
    log.patrolStatus,
    log.patrolStatus === '正常良好'
      ? '不需追蹤'
      : log.followUpResolved
        ? '已追蹤結案'
        : '待處理',
    log.teacherOrUnit || '無',
    log.summary,
    log.observations,
    log.actionItems.join('；'),
    log.ownerName,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(String(cell ?? ''))).join(','))
      .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `校園巡堂月報表_${monthKey}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
