import type { Timestamp } from 'firebase/firestore';

export type ZoneCategory =
  | '教室教學'
  | '校園環境'
  | '安全設施'
  | '學生秩序'
  | '其他場域';

export type PatrolStatus = '正常良好' | '需追蹤提醒' | '異常待修';

export const ZONE_CATEGORIES: ZoneCategory[] = [
  '教室教學',
  '校園環境',
  '安全設施',
  '學生秩序',
  '其他場域',
];

export const PATROL_STATUSES: PatrolStatus[] = [
  '正常良好',
  '需追蹤提醒',
  '異常待修',
];

// Volumetric bounds synchronized verbatim with firebase-blueprint.json & firestore.rules
export const PATROL_LIMITS = {
  ownerNameMax: 100,
  locationNameMax: 120,
  summaryMax: 600,
  observationsMax: 2000,
  transcriptMax: 3000,
  actionItemsMaxCount: 10,
  actionItemMaxLen: 200,
  teacherOrUnitMax: 100,
  photoDataUrlMax: 350000,
  executiveSummaryMax: 4000,
  reportListMaxCount: 10,
  reportListItemMaxLen: 400,
} as const;

export interface PatrolLog {
  id: string;
  ownerId: string;
  ownerName: string;
  locationName: string;
  zoneCategory: ZoneCategory;
  patrolStatus: PatrolStatus;
  followUpResolved: boolean;
  summary: string;
  observations: string;
  transcript: string;
  actionItems: string[];
  teacherOrUnit: string;
  photoDataUrl: string;
  monthKey: string;
  patrolDateStr: string;
  patrolTimeStr: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface PatrolDraft {
  locationName: string;
  zoneCategory: ZoneCategory;
  patrolStatus: PatrolStatus;
  followUpResolved: boolean;
  summary: string;
  observations: string;
  transcript: string;
  actionItems: string[];
  teacherOrUnit: string;
  photoDataUrl: string;
  patrolDateStr: string;
  patrolTimeStr: string;
}

export interface MonthlyReport {
  id: string;
  ownerId: string;
  monthKey: string;
  totalCount: number;
  normalCount: number;
  followUpCount: number;
  issueCount: number;
  executiveSummary: string;
  keyHighlights: string[];
  recommendations: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
