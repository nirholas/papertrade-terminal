import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORIGIN, buildAgentCard, buildApiCatalog, buildOpenApi, buildServerCard } from '../scripts/build-discovery.mjs';
import { serverDef } from '../site/functions/_lib/tools.js';

const def = serverDef(ORIGIN);

describe('discovery documents', () => {
  it('server card names the streamable-http endpoint and lists every tool', () => {
    const card = buildServerCard(def);
    expect(card.transport).toEqual({ type: 'streamable-http', endpoint: `${ORIGIN}/mcp` });
    expect(card.tools.map((t: { name: string }) => t.name)).toEqual(def.tools.map((t) => t.name));
    expect(card.authentication.required).toBe(false);
  });

  it('agent card maps one skill per tool and only read-only tags', () => {
    const card = buildAgentCard(def);
    expect(card.skills).toHaveLength(def.tools.length);
    expect(card.skills.every((s: { tags: string[] }) => s.tags.includes('read-only'))).toBe(true);
    expect(card.defaultInputModes.length).toBeGreaterThan(0);
  });

  it('api-catalog is an RFC 9727 linkset pointing at openapi, docs and llms.txt', () => {
    const text = JSON.stringify(buildApiCatalog());
    for (const href of [`${ORIGIN}/openapi.json`, `${ORIGIN}/docs/`, `${ORIGIN}/llms.txt`, `${ORIGIN}/mcp`]) expect(text).toContain(href);
  });

  it('openapi 3.1 documents /mcp and the read proxy', () => {
    const api = buildOpenApi(def);
    expect(api.openapi).toBe('3.1.0');
    expect(Object.keys(api.paths)).toContain('/mcp');
    expect(api.paths['/mcp'].post.operationId).toBe('mcpRpc');
    expect(Object.keys(api.components.schemas)).toHaveLength(def.tools.length);
  });

  it('never emits an em or en dash', () => {
    const all = JSON.stringify([buildServerCard(def), buildAgentCard(def), buildApiCatalog(), buildOpenApi(def)]);
    expect(all).not.toMatch(/[–—]/);
  });

  it('keeps the committed files in sync with the registry', () => {
    const onDisk = JSON.parse(readFileSync(new URL('../site/public/.well-known/mcp/server-card.json', import.meta.url), 'utf8'));
    expect(onDisk.tools.map((t: { name: string }) => t.name)).toEqual(def.tools.map((t) => t.name));
  });
});
