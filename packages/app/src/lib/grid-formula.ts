/**
 * Safe formula evaluator for cosmetic grid cells (`display_formula`) and conditional
 * cell styling. Recursive descent over a fixed grammar — arithmetic, comparison and
 * logical operators plus `doc.<path>` / `row.<path>` reads and literals. It has NO
 * function calls, NO arbitrary member access, NO `new Function` / `eval`, and no DB
 * access: it can only compute over the row it is handed. Parse/eval errors return
 * `{ error }` and never throw. A leading `eval:` is stripped.
 */

export interface FormulaResult {
  value: unknown;
  error?: string;
}

interface Token {
  type: 'num' | 'str' | 'ident' | 'op' | 'eof';
  value: string;
}

const OPS2 = ['&&', '||', '==', '!=', '<=', '>='];
const OPS1 = '+-*/%!<>()';

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (OPS2.includes(src.slice(i, i + 2))) {
      out.push({ type: 'op', value: src.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < src.length && src[i] !== c) {
        s += src[i]!;
        i++;
      }
      if (i >= src.length) throw new Error('unterminated string');
      i++;
      out.push({ type: 'str', value: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let s = '';
      while (i < src.length && /[0-9.]/.test(src[i]!)) {
        s += src[i]!;
        i++;
      }
      out.push({ type: 'num', value: s });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i]!)) {
        s += src[i]!;
        i++;
      }
      out.push({ type: 'ident', value: s });
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ type: 'op', value: c });
      i++;
      continue;
    }
    throw new Error(`unexpected '${c}'`);
  }
  out.push({ type: 'eof', value: '' });
  return out;
}

const toBool = (v: unknown): boolean => !!v;
const looseEq = (a: unknown, b: unknown): boolean => a === b || String(a) === String(b);

function resolvePath(path: string, scope: Record<string, unknown>): unknown {
  let cur: unknown = scope;
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly toks: Token[],
    private readonly scope: Record<string, unknown>,
  ) {}

  private peek(): Token {
    return this.toks[this.pos]!;
  }
  private next(): Token {
    return this.toks[this.pos++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === v;
  }
  private opIn(vs: string[]): boolean {
    const t = this.peek();
    return t.type === 'op' && vs.includes(t.value);
  }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new Error(`expected '${v}'`);
    this.pos++;
  }

  parse(): unknown {
    const v = this.or();
    if (this.peek().type !== 'eof') throw new Error(`unexpected '${this.peek().value}'`);
    return v;
  }

  private or(): unknown {
    let v = this.and();
    while (this.isOp('||')) {
      this.next();
      const r = this.and();
      v = toBool(v) || toBool(r);
    }
    return v;
  }
  private and(): unknown {
    let v = this.equality();
    while (this.isOp('&&')) {
      this.next();
      const r = this.equality();
      v = toBool(v) && toBool(r);
    }
    return v;
  }
  private equality(): unknown {
    let v = this.comparison();
    while (this.opIn(['==', '!='])) {
      const op = this.next().value;
      const r = this.comparison();
      v = op === '==' ? looseEq(v, r) : !looseEq(v, r);
    }
    return v;
  }
  private comparison(): unknown {
    let v = this.additive();
    while (this.opIn(['<', '<=', '>', '>='])) {
      const op = this.next().value;
      const a = Number(v);
      const b = Number(this.additive());
      v = op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    return v;
  }
  private additive(): unknown {
    let v = this.multiplicative();
    while (this.opIn(['+', '-'])) {
      const op = this.next().value;
      const r = this.multiplicative();
      if (op === '+') {
        v = typeof v === 'string' || typeof r === 'string' ? String(v) + String(r) : Number(v) + Number(r);
      } else {
        v = Number(v) - Number(r);
      }
    }
    return v;
  }
  private multiplicative(): unknown {
    let v = this.unary();
    while (this.opIn(['*', '/', '%'])) {
      const op = this.next().value;
      const a = Number(v);
      const b = Number(this.unary());
      v = op === '*' ? a * b : op === '/' ? a / b : a % b;
    }
    return v;
  }
  private unary(): unknown {
    if (this.isOp('-')) {
      this.next();
      return -Number(this.unary());
    }
    if (this.isOp('!')) {
      this.next();
      return !toBool(this.unary());
    }
    return this.primary();
  }
  private primary(): unknown {
    const t = this.peek();
    if (t.type === 'op' && t.value === '(') {
      this.next();
      const v = this.or();
      this.expect(')');
      return v;
    }
    if (t.type === 'num') {
      this.next();
      return Number(t.value);
    }
    if (t.type === 'str') {
      this.next();
      return t.value;
    }
    if (t.type === 'ident') {
      this.next();
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      return resolvePath(t.value, this.scope);
    }
    throw new Error(`unexpected '${t.value || 'end'}'`);
  }
}

/** Evaluate a formula over `scope` (typically `{ doc: row, row }`). Never throws. */
export function evalFormula(expr: string, scope: Record<string, unknown>): FormulaResult {
  try {
    const src = expr.startsWith('eval:') ? expr.slice(5) : expr;
    return { value: new Parser(tokenize(src), scope).parse() };
  } catch (e) {
    return { value: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}
