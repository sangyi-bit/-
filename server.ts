import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY 環境變數尚未設定，請於 AI Studio Secrets 面板確認金鑰。');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getFriendlyGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('400')) {
    return { status: 400, message: `Gemini API 金鑰驗證失敗，請檢查 Settings > Secrets 設定：${raw}` };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return { status: 429, message: '目前請求頻率超過配額，請稍後再試。' };
  }
  if (raw.includes('GEMINI_API_KEY')) {
    return { status: 500, message: raw };
  }
  return { status: 500, message: `AI 分析處理失敗：${raw}` };
}

interface AnalyzeRequestBody {
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  noteText?: string;
}

interface MonthlyReportLogInput {
  locationName: string;
  zoneCategory: string;
  patrolStatus: string;
  followUpResolved: boolean;
  summary: string;
  observations: string;
  actionItems: string[];
  teacherOrUnit: string;
  patrolDateStr: string;
  patrolTimeStr: string;
}

interface MonthlyReportRequestBody {
  monthKey: string;
  logs: MonthlyReportLogInput[];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/patrol/analyze', async (req: Request, res: Response) => {
    try {
      const body = req.body as AnalyzeRequestBody;
      const hasImage = Boolean(body.imageBase64 && body.imageMimeType);
      const hasAudio = Boolean(body.audioBase64 && body.audioMimeType);
      const noteText = (body.noteText || '').trim();

      if (!hasImage && !hasAudio && !noteText) {
        res.status(400).json({ error: '請至少提供現場照片、口述錄音或文字補充其中一項。' });
        return;
      }

      const ai = getAiClient();
      let transcriptText = noteText;

      if (hasAudio && body.audioBase64 && body.audioMimeType) {
        const cleanAudioMime = body.audioMimeType.split(';')[0] || 'audio/webm';
        const transcribeRes = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanAudioMime,
                  data: body.audioBase64,
                },
              },
              {
                text: '請將這段台灣校園巡堂口述錄音精確轉錄為繁體中文逐字稿，忠實保留班級名稱、校園地點、設備狀況與需要追蹤或處理的事項。僅輸出轉錄文字，不要加上額外說明。',
              },
            ],
          },
        });
        const spokenText = (transcribeRes.text || '').trim();
        if (spokenText && noteText) {
          transcriptText = `${spokenText}\n補充說明：${noteText}`;
        } else if (spokenText) {
          transcriptText = spokenText;
        }
      }

      const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
      if (hasImage && body.imageBase64 && body.imageMimeType) {
        parts.push({
          inlineData: {
            mimeType: body.imageMimeType,
            data: body.imageBase64,
          },
        });
      }

      const promptLines = [
        '你是一位專業且細心的台灣學校行政巡堂助理。',
        '請根據提供的現場照片（若有）以及巡堂人員的口述／補充紀錄，辨識巡堂地點或班級並自動整理成結構化的巡堂紀錄表單欄位。',
        '',
        '【規則】',
        '1. 所有輸出必須使用自然流暢的繁體中文（台灣校務用語）。',
        '2. locationName：優先讀取照片中的班級門牌（如「三年二班教室」「電腦教室一」）或校園空間特徵（如「操場跑道東側」「圖書館二樓」「穿堂」），若口述內容有明確指定地點則以兩者整合出精確名稱（不超過 60 字）。',
        '3. zoneCategory：必須為以下五個選項之一：「教室教學」、「校園環境」、「安全設施」、「學生秩序」、「其他場域」。',
        '4. patrolStatus：必須為以下三個選項之一：「正常良好」、「需追蹤提醒」、「異常待修」。若口述或畫面發現燈具故障、漏水、積水、門鎖損壞或安全疑慮，請選「異常待修」；若有秩序提醒或輕微整潔需改善，請選「需追蹤提醒」；一切正常則選「正常良好」。',
        '5. summary：精簡扼要的 1 至 2 句巡堂重點摘要（20 至 120 字）。',
        '6. observations：將照片觀察到的環境狀況與口述內容條理化整理（不超過 500 字）。',
        '7. actionItems：列出具體待辦追蹤或報修建議（陣列，最多 5 項；若無需特別處置可回傳空陣列）。',
        '8. teacherOrUnit：相關班級、教師或權責處室（例如「總務處」「學務處」「教務處」「三年二班」，若無特定對象請填「無」）。',
        '',
        `【巡堂口述與文字內容】\n${transcriptText || '（未提供語音或文字描述，請依現場照片客觀辨識場所與環境狀況）'}`,
      ];

      parts.push({ text: promptLines.join('\n') });

      const analyzeRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              locationName: { type: Type.STRING },
              zoneCategory: {
                type: Type.STRING,
                enum: ['教室教學', '校園環境', '安全設施', '學生秩序', '其他場域'],
              },
              patrolStatus: {
                type: Type.STRING,
                enum: ['正常良好', '需追蹤提醒', '異常待修'],
              },
              summary: { type: Type.STRING },
              observations: { type: Type.STRING },
              actionItems: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              teacherOrUnit: { type: Type.STRING },
            },
            required: [
              'locationName',
              'zoneCategory',
              'patrolStatus',
              'summary',
              'observations',
              'actionItems',
              'teacherOrUnit',
            ],
          },
        },
      });

      const rawJson = (analyzeRes.text || '{}').trim();
      const parsed = JSON.parse(rawJson);

      res.json({
        transcript: transcriptText,
        structured: {
          locationName: String(parsed.locationName || '未命名地點').slice(0, 120),
          zoneCategory: parsed.zoneCategory || '校園環境',
          patrolStatus: parsed.patrolStatus || '正常良好',
          summary: String(parsed.summary || '').slice(0, 600),
          observations: String(parsed.observations || '').slice(0, 2000),
          actionItems: Array.isArray(parsed.actionItems)
            ? parsed.actionItems.slice(0, 10).map((item: unknown) => String(item).slice(0, 200))
            : [],
          teacherOrUnit: String(parsed.teacherOrUnit || '無').slice(0, 100),
        },
      });
    } catch (err) {
      const mapped = getFriendlyGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  app.post('/api/patrol/monthly-report', async (req: Request, res: Response) => {
    try {
      const body = req.body as MonthlyReportRequestBody;
      const monthKey = (body.monthKey || '').trim();
      const logs = Array.isArray(body.logs) ? body.logs : [];

      if (!monthKey || logs.length === 0) {
        res.status(400).json({ error: '該月份尚無巡堂紀錄可供彙整。' });
        return;
      }

      const ai = getAiClient();
      const serializedLogs = logs
        .slice(0, 200)
        .map(
          (log, idx) =>
            `${idx + 1}. [${log.patrolDateStr} ${log.patrolTimeStr}] ${log.locationName}（${log.zoneCategory}｜狀態：${log.patrolStatus}${log.followUpResolved ? '・已結案' : ''}｜相關單位：${log.teacherOrUnit || '無'}）\n   重點：${log.summary}\n   待辦：${log.actionItems.length > 0 ? log.actionItems.join('；') : '無'}`
        )
        .join('\n');

      const prompt = [
        `你是一位協助台灣中小學或大專校院彙整月度校務巡檢報表的資深行政秘書。`,
        `請依據以下 ${monthKey} 月份共 ${logs.length} 筆校園巡堂紀錄，撰寫一份條理分明、可直接納入校務會議或行政呈核的「每月巡堂彙整分析」。`,
        '',
        '【輸出規定】',
        '1. 全部使用繁體中文，語氣專業客觀、簡明扼要。',
        '2. executiveSummary：本月巡堂執行概況與整體校園安全教學品質總評（150 至 450 字）。',
        '3. keyHighlights：歸納本月各巡檢類別的重要觀察、表現優良班級／場域或重複出現的重點事項（3 至 6 點）。',
        '4. recommendations：彙整未結案之待修／追蹤事項優先處理順序，並提出下個月巡堂重心的具體建議（3 至 6 點）。',
        '',
        `【${monthKey} 巡堂紀錄明細】`,
        serializedLogs,
      ].join('\n');

      const reportRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: { type: Type.STRING },
              keyHighlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['executiveSummary', 'keyHighlights', 'recommendations'],
          },
        },
      });

      const rawJson = (reportRes.text || '{}').trim();
      const parsed = JSON.parse(rawJson);

      res.json({
        executiveSummary: String(parsed.executiveSummary || '').slice(0, 4000),
        keyHighlights: Array.isArray(parsed.keyHighlights)
          ? parsed.keyHighlights.slice(0, 10).map((s: unknown) => String(s).slice(0, 400))
          : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations.slice(0, 10).map((s: unknown) => String(s).slice(0, 400))
          : [],
      });
    } catch (err) {
      const mapped = getFriendlyGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  if (IS_PROD) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.get('*', async (req: Request, res: Response, next) => {
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
