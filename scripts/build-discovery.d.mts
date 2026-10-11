import type { McpServerDef } from '../site/functions/_lib/mcp.js';
import type { ToolContext } from '../site/functions/_lib/tools.js';

type Def = McpServerDef<ToolContext>;
export const ORIGIN: string;
export function buildServerCard(def: Def): any;
export function buildAgentCard(def: Def): any;
export function buildApiCatalog(): any;
export function buildOpenApi(def: Def): any;
export function main(): Promise<void>;
