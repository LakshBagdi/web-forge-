import { ExecContext, resolveRef, resolveTemplates } from './context';

/**
 * A small, safe boolean expression evaluator for condition nodes.
 * No eval / new Function — a hand-written recursive-descent parser, so a workflow
 * author cannot run arbitrary JS on the server.
 *
 * Grammar (highest to lowest precedence):
 *   primary   := '(' or ')' | '!' unary | literal | ref
 *   compare   := primary ( (==|!=|>|>=|<|<=|contains|startsWith|endsWith|matches) primary )?
 *   and       := compare ( '&&' compare )*
 *   or        := and ( '||' and )*
 *
 * Refs are bare paths like  steps.http1.output.status  or  input.amount
 * Literals: numbers, 'single' or "double" quoted strings, true, false, null.
 */

type Tok = { t: string; v?: string };

const OPS = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '(', ')', '!'];
const WORD_OPS = ['contains', 'startsWith', 'endsWith', 'matches'];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    let matchedOp = false;
    for (const op of OPS) {
      if (src.startsWith(op, i)) { toks.push({ t: op }); i += op.length; matchedOp = true; break; }
    }
    if (matchedOp) continue;
    // word (ref, number, keyword, word-op)
    let j = i;
    while (j < src.length && /[A-Za-z0-9_.$\-+]/.test(src[j])) j++;
    const word = src.slice(i, j);
    if (word === '') { i++; continue; } // skip unknown char
    if (WORD_OPS.includes(word)) toks.push({ t: word });
    else if (word === 'true' || word === 'false') toks.push({ t: 'bool', v: word });
    else if (word === 'null') toks.push({ t: 'null' });
    else if (/^-?\d+(\.\d+)?$/.test(word)) toks.push({ t: 'num', v: word });
    else toks.push({ t: 'ref', v: word });
    i = j;
  }
  return toks;
}

class Parser {
  pos = 0;
  constructor(private toks: Tok[], private ctx: ExecContext) {}
  peek() { return this.toks[this.pos]; }
  next() { return this.toks[this.pos++]; }

  parse(): any {
    const v = this.parseOr();
    return v;
  }
  parseOr(): any {
    let left = this.parseAnd();
    while (this.peek()?.t === '||') { this.next(); const r = this.parseAnd(); left = truthy(left) || truthy(r); }
    return left;
  }
  parseAnd(): any {
    let left = this.parseCompare();
    while (this.peek()?.t === '&&') { this.next(); const r = this.parseCompare(); left = truthy(left) && truthy(r); }
    return left;
  }
  parseCompare(): any {
    const left = this.parseUnary();
    const op = this.peek()?.t;
    if (op && ['==', '!=', '>', '>=', '<', '<=', ...WORD_OPS].includes(op)) {
      this.next();
      const right = this.parseUnary();
      return compare(op, left, right);
    }
    return left;
  }
  parseUnary(): any {
    if (this.peek()?.t === '!') { this.next(); return !truthy(this.parseUnary()); }
    return this.parsePrimary();
  }
  parsePrimary(): any {
    const tok = this.next();
    if (!tok) return undefined;
    if (tok.t === '(') { const v = this.parseOr(); if (this.peek()?.t === ')') this.next(); return v; }
    if (tok.t === 'str') return tok.v;
    if (tok.t === 'num') return Number(tok.v);
    if (tok.t === 'bool') return tok.v === 'true';
    if (tok.t === 'null') return null;
    if (tok.t === 'ref') return resolveRef(tok.v!, this.ctx);
    return undefined;
  }
}

function truthy(v: any): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}

function compare(op: string, a: any, b: any): boolean {
  switch (op) {
    case '==': return looseEq(a, b);
    case '!=': return !looseEq(a, b);
    case '>': return Number(a) > Number(b);
    case '>=': return Number(a) >= Number(b);
    case '<': return Number(a) < Number(b);
    case '<=': return Number(a) <= Number(b);
    case 'contains': return String(a).includes(String(b)) || (Array.isArray(a) && a.includes(b));
    case 'startsWith': return String(a).startsWith(String(b));
    case 'endsWith': return String(a).endsWith(String(b));
    case 'matches': try { return new RegExp(String(b)).test(String(a)); } catch { return false; }
    default: return false;
  }
}

function looseEq(a: any, b: any): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    if (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

/** Evaluate a condition node to a boolean. Supports either a raw expression
 *  string (config.expression) or a structured {left, operator, right}. */
export function evaluateCondition(config: any, ctx: ExecContext): boolean {
  if (config?.expression && typeof config.expression === 'string') {
    try {
      return truthy(new Parser(tokenize(config.expression), ctx).parse());
    } catch {
      return false;
    }
  }
  // structured form
  // Left accepts either a template ({{steps.x.output.y}}) or a bare path (steps.x.output.y).
  // Anything else (a number, a quoted literal) is used as-is.
  const hasTemplate = (v: any) => typeof v === 'string' && /\{\{[^}]+\}\}/.test(v);
  let left = config?.left;
  if (hasTemplate(left)) left = resolveTemplates(left, ctx);
  else if (typeof left === 'string' && /^[A-Za-z_][\w.]*$/.test(left.trim())) left = resolveRef(left.trim(), ctx);
  const op = config?.operator || '==';
  // Right side may also use templates; otherwise it is a literal.
  let right = hasTemplate(config?.right) ? resolveTemplates(config.right, ctx) : config?.right;
  if (op === 'exists') return left !== undefined && left !== null;
  if (op === 'truthy') return truthy(left);
  return compare(mapOp(op), left, right);
}

function mapOp(op: string): string {
  const m: Record<string, string> = {
    eq: '==', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
    contains: 'contains', startsWith: 'startsWith', endsWith: 'endsWith', matches: 'matches',
  };
  return m[op] || op;
}

export { tokenize };
