export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  body: string;
  lastmod?: string;
}
export interface TocItem {
  depth: number;
  id: string;
  text: string;
}
export interface SearchEntry {
  u: string;
  p: string;
  h: string;
  t: string;
}
export const ORIGIN: string;
export const SITE_NAME: string;
export const SUMMARY: string;
export function parseFrontMatter(source: string): { data: Record<string, string | number>; body: string };
export function escapeHtml(value: string): string;
export function plainText(markdown: string): string;
export function slugify(text: string): string;
export function createSlugger(): (text: string) => string;
export function renderMarkdown(markdown: string): { html: string; toc: TocItem[] };
export function pageUrl(slug: string): string;
export function twinUrl(slug: string): string;
export function buildSearchIndex(pages: DocPage[]): { version: number; entries: SearchEntry[] };
export function parsePage(filename: string, source: string, lastmod?: string): DocPage;
export function sortPages(pages: DocPage[]): DocPage[];
export function buildTwin(page: DocPage, origin?: string): string;
export function renderPage(page: DocPage, pages: DocPage[], origin?: string): string;
export function buildSitemap(pages: DocPage[], origin?: string): string;
export function buildLlmsTxt(pages: DocPage[], origin?: string): string;
export function buildLlmsFull(pages: DocPage[], origin?: string): string;
export function findDash(files: Map<string, string>): string | null;
export function buildFiles(pages: DocPage[], origin?: string): Map<string, string>;
export function loadPages(docsDir: string): Promise<DocPage[]>;
