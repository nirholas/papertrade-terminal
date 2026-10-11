import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN,
  buildFiles,
  buildLlmsFull,
  buildLlmsTxt,
  buildSearchIndex,
  buildSitemap,
  findDash,
  loadPages,
  parseFrontMatter,
  parsePage,
  renderMarkdown,
  slugify,
  sortPages,
  type DocPage,
} from '../scripts/build-docs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['index', 'quickstart', 'concepts', 'reference', 'mcp', 'connect-your-ai', 'agent-discovery', 'self-hosting', 'security', 'faq', 'changelog'];

let pages: DocPage[] = [];
let files: Map<string, string>;

beforeAll(async () => {
  pages = sortPages(await loadPages(path.join(root, 'docs')));
  files = buildFiles(pages);
});

describe('front matter', () => {
  it('parses flat keys, quotes and numbers', () => {
    const { data, body } = parseFrontMatter('---\ntitle: "Hello: world"\ndescription: A page\norder: 3\n---\n# Hello\n');
    expect(data).toEqual({ title: 'Hello: world', description: 'A page', order: 3 });
    expect(body).toBe('# Hello\n');
  });
  it('returns the whole text when there is no front matter', () => {
    expect(parseFrontMatter('# Only body\n')).toEqual({ data: {}, body: '# Only body\n' });
  });
  it('rejects a page without a title or description', () => {
    expect(() => parsePage('x.md', '---\ndescription: d\n---\nbody')).toThrow(/title/);
    expect(() => parsePage('x.md', '---\ntitle: t\n---\nbody')).toThrow(/description/);
  });
  it('every source page has title, description and a unique order', () => {
    expect(pages.map((p) => p.slug).sort()).toEqual([...REQUIRED].sort());
    for (const p of pages) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.order).toBeLessThan(1000);
    }
    expect(new Set(pages.map((p) => p.order)).size).toBe(pages.length);
    expect(pages[0].slug).toBe('index');
  });
});

describe('headings, anchors and toc', () => {
  it('gives h2 and h3 stable ids and anchors and builds a toc', () => {
    const { html, toc } = renderMarkdown('# Title\n\n## First part\n\n### Deep `code` dive\n\n## First part\n');
    expect(html).toContain('<h2 id="first-part">');
    expect(html).toContain('href="#first-part"');
    expect(html).toContain('<h2 id="first-part-1">');
    expect(toc).toEqual([
      { depth: 2, id: 'first-part', text: 'First part' },
      { depth: 3, id: 'deep-code-dive', text: 'Deep code dive' },
      { depth: 2, id: 'first-part-1', text: 'First part' },
    ]);
  });
  it('slugifies predictably', () => {
    expect(slugify('Deep link parameters')).toBe('deep-link-parameters');
    expect(slugify('A & B (v2)')).toBe('a-and-b-v2');
  });
  it('wraps code blocks with a copy button and escapes content', () => {
    const { html } = renderMarkdown('```json\n{"a": "<b>"}\n```\n');
    expect(html).toContain('class="copy"');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('language-json');
  });
  it('generated pages have the reference anchor that other pages link to', () => {
    expect(files.get('docs/reference/index.html')).toContain('id="deep-link-parameters"');
  });
});

describe('generated pages', () => {
  it('writes an html page and a markdown twin for every doc', () => {
    expect(files.has('docs/index.html')).toBe(true);
    expect(files.has('docs/index.md')).toBe(true);
    for (const slug of REQUIRED.filter((s) => s !== 'index')) {
      expect(files.has(`docs/${slug}/index.html`)).toBe(true);
      expect(files.has(`docs/${slug}.md`)).toBe(true);
    }
  });
  it('has canonical, description, skip link, sidebar and prev/next', () => {
    const html = files.get('docs/quickstart/index.html')!;
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/docs/quickstart/">`);
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}">/);
    expect(html).toContain('class="skip"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });
  it('has no inline script or style (CSP) and loads the static assets', () => {
    for (const [name, content] of files) {
      if (!name.endsWith('.html')) continue;
      expect(content, name).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
      expect(content, name).not.toMatch(/<style[\s>]/);
      expect(content, name).not.toMatch(/\sstyle="/);
      expect(content, name).not.toMatch(/\son[a-z]+="/);
      expect(content, name).toContain('/docs/docs.css');
      expect(content, name).toContain('/docs/docs.js');
    }
  });
  it('keeps the disclaimer and the leverage risk line on the overview and security pages', () => {
    for (const slug of ['index', 'security']) {
      const text = files.get(`docs/${slug}.md`)!;
      expect(text).toMatch(/not affiliated with Papertrade/i);
      expect(text).toMatch(/1000x/);
    }
  });
});

describe('search index', () => {
  it('has an entry per section with url, page, heading and text', () => {
    const index = buildSearchIndex(pages);
    expect(index.version).toBe(1);
    expect(index.entries.length).toBeGreaterThan(pages.length);
    for (const e of index.entries) {
      expect(e.u.startsWith('/docs/')).toBe(true);
      expect(e.p).toBeTruthy();
      expect(e.h).toBeTruthy();
    }
  });
  it('finds real content by tool name and by section anchor', () => {
    const entries = buildSearchIndex(pages).entries;
    const hit = entries.find((e) => e.u.startsWith('/docs/mcp/') && e.t.includes('build_trade_plan'));
    expect(hit).toBeTruthy();
    expect(entries.some((e) => e.u === '/docs/reference/#deep-link-parameters')).toBe(true);
  });
  it('does not index fenced code fences as headings', () => {
    const index = buildSearchIndex([{ slug: 'x', title: 'X', description: 'd', order: 1, body: '# X\n\n```sh\n## not a heading\n```\n\n## Real\n\ntext\n' }]);
    expect(index.entries.map((e) => e.h)).toEqual(['X', 'Real']);
  });
  it('is written as valid json', () => {
    expect(() => JSON.parse(files.get('docs/search-index.json')!)).not.toThrow();
  });
});

describe('sitemap', () => {
  it('lists the landing page, the app and every docs page with absolute urls', () => {
    const xml = buildSitemap(pages);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/app/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/docs/</loc>`);
    for (const slug of REQUIRED.filter((s) => s !== 'index')) expect(xml).toContain(`<loc>${ORIGIN}/docs/${slug}/</loc>`);
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});

describe('llms files', () => {
  it('llms.txt follows the llmstxt.org shape', () => {
    const txt = buildLlmsTxt(pages);
    const lines = txt.split('\n');
    expect(lines[0]).toBe('# Papertrade Terminal');
    expect(lines[2].startsWith('> ')).toBe(true);
    expect(txt).toMatch(/^## Docs$/m);
    expect(txt).toMatch(/^## MCP server$/m);
    expect(txt).toMatch(/^## Discovery$/m);
    expect(txt).toContain(`(${ORIGIN}/mcp)`);
    for (const p of pages) expect(txt).toContain(`[${p.title}](${ORIGIN}/docs/${p.slug}.md)`);
    expect(txt).toMatch(/not affiliated with Papertrade/i);
  });
  it('llms-full.txt inlines every page with absolute links', () => {
    const full = buildLlmsFull(pages);
    for (const p of pages) expect(full).toContain(`<!-- source: ${ORIGIN}/docs/${p.slug}.md -->`);
    expect(full).toContain(`](${ORIGIN}/docs/quickstart/)`);
    expect(full).not.toMatch(/\]\(\/docs\//);
  });
  it('is written to the expected paths', () => {
    expect(files.has('llms.txt')).toBe(true);
    expect(files.has('llms-full.txt')).toBe(true);
    expect(files.has('sitemap.xml')).toBe(true);
  });
});

describe('typography', () => {
  it('contains no em-dash or en-dash anywhere in the generated output', () => {
    expect(findDash(files)).toBeNull();
  });
  it('contains no em-dash or en-dash in the markdown sources', () => {
    for (const p of pages) expect(`${p.title}${p.description}${p.body}`, p.slug).not.toMatch(/[–—]/);
  });
  it('findDash reports the location of a violation', () => {
    expect(findDash(new Map([['a.md', 'ok\nbad — here']]))).toBe('a.md:2');
  });
});

describe('internal links', () => {
  const generated = (p: string) => {
    const clean = p.split('#')[0].split('?')[0];
    if (clean === '/docs/' || clean === '/docs') return 'docs/index.html';
    if (clean.endsWith('/')) return `${clean.slice(1)}index.html`;
    return clean.slice(1);
  };
  const external = (p: string) =>
    p === '/' || p.startsWith('/app') || p.startsWith('/.well-known/') || ['/openapi.json', '/mcp', '/sitemap.xml', '/robots.txt'].includes(p.split('#')[0]);

  it('every docs link and anchor in every page resolves', () => {
    const ids = new Map<string, Set<string>>();
    for (const [name, content] of files) {
      if (!name.endsWith('.html')) continue;
      ids.set(name, new Set([...content.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    }
    const broken: string[] = [];
    for (const [name, content] of files) {
      if (!name.endsWith('.html')) continue;
      for (const m of content.matchAll(/href="([^"]+)"/g)) {
        const href = m[1].replace(/&amp;/g, '&');
        if (/^(https?:|mailto:)/.test(href)) continue;
        if (href.startsWith('#')) {
          if (!ids.get(name)!.has(decodeURIComponent(href.slice(1)))) broken.push(`${name} -> ${href}`);
          continue;
        }
        if (!href.startsWith('/')) continue;
        const base = href.split('#')[0].split('?')[0];
        if (external(base)) continue;
        const target = generated(base);
        if (!files.has(target) && !['docs/docs.css', 'docs/docs.js', 'llms.txt', 'llms-full.txt'].includes(target)) {
          broken.push(`${name} -> ${href}`);
          continue;
        }
        const hash = href.split('#')[1];
        if (hash && ids.has(target) && !ids.get(target)!.has(hash)) broken.push(`${name} -> ${href} (missing anchor)`);
      }
    }
    expect(broken).toEqual([]);
  });
});
