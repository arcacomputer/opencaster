export const ACCOUNT_ID: string;
export const DATASET: string;
export type ReportKey = 'totals' | 'trend' | 'pages' | 'clicks' | 'countries' | 'sources' | 'devices' | 'vitals' | 'requests' | 'errors';
export interface AnalyticsRow {
  [key: string]: unknown;
  events?: number | string;
  mean?: number | string;
  day?: number | string;
  kind?: string;
  page?: string;
  name?: string;
  country?: string;
  device?: string;
  browser?: string;
}
export type AnalyticsReport = Partial<Record<ReportKey, AnalyticsRow[]>>;
export type AnalyticsQuery = (sql: string, token: string) => Promise<AnalyticsRow[]>;
export function buildQueries(days: number): Record<ReportKey, string>;
export function queryAnalytics(sql: string, token: string, fetcher?: typeof fetch): Promise<AnalyticsRow[]>;
export function collectReport(days: number, token: string, query?: AnalyticsQuery): Promise<AnalyticsReport>;
export function escapeHtml(value: unknown): string;
export function renderReport(report: AnalyticsReport, options?: { days?: number; generatedAt?: Date; dashboard?: boolean }): string;
