/**
 * Execution context + safe template resolution.
 *
 * Templates use {{ path }} syntax and read ONLY from the run context
 * (trigger input, prior step outputs, workflow variables). process.env and the
 * host are never exposed, so a workflow can't read server secrets through templates.
 */

export interface ExecContext {
  trigger: { input: any };
  input: any; // alias for trigger.input
  steps: Record<string, { output: any; status: string }>;
  vars: Record<string, any>;
  /** Clock values captured when the run started, e.g. {{now.iso}}, {{now.in30min}}. */
  now: Record<string, string | number>;
}

export function makeNow(at = new Date()): Record<string, string | number> {
  const plus = (min: number) => new Date(at.getTime() + min * 60_000).toISOString();
  return {
    iso: at.toISOString(), date: at.toISOString().slice(0, 10), epochMs: at.getTime(),
    in5min: plus(5), in15min: plus(15), in30min: plus(30), in1h: plus(60), in2h: plus(120), in1day: plus(1440),
  };
}

export function getPath(obj: any, path: string): any {
  if (!path) return obj;
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    // support array index like items.0
    cur = cur[p];
  }
  return cur;
}

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Resolve a single operand/path string against the context. */
export function resolveRef(ref: string, ctx: ExecContext): any {
  return getPath(ctx, ref);
}

/**
 * Resolve templates in any JSON-like value (string, object, array).
 * - A string that is exactly one template returns the raw resolved value.
 * - A string with embedded templates returns an interpolated string.
 */
export function resolveTemplates(value: any, ctx: ExecContext): any {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact) return resolveRef(exact[1], ctx);
    return value.replace(TEMPLATE_RE, (_m, expr) => {
      const v = resolveRef(String(expr), ctx);
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, ctx);
    return out;
  }
  return value;
}


/** {{refs}} inside any value that currently resolve to nothing (typos, steps that haven't run yet). */
export function unresolvedRefs(value: any, ctx: ExecContext, out = new Set<string>()): string[] {
  if (typeof value === 'string') {
    for (const m of value.matchAll(TEMPLATE_RE)) if (resolveRef(m[1], ctx) === undefined) out.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => unresolvedRefs(v, ctx, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => unresolvedRefs(v, ctx, out));
  return [...out];
}
