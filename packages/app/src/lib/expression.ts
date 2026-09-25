/**
 * Safe expression evaluator for depends_on / mandatory_depends_on /
 * read_only_depends_on. Recursive descent, NO `eval`; multi-root scope
 * `{ doc, user }`.
 *
 *   expr     := or
 *   or       := and ( "||" and )*
 *   and      := not ( "&&" not )*
 *   not      := "!" not | cmp
 *   cmp      := primary ( ("=="|"!="|"<"|"<="|">"|">="|"in"|"not in") primary )?
 *   primary  := "(" expr ")" | array | literal | doc.path | user.path | ident
 *
 * `evaluateExpr` returns `{ value, error }` so the CALLER owns the safe-degrade
 * direction: visibility fails OPEN, mandatory/read_only fail CLOSED. A parse
 * failure never throws and never silently weakens a constraint. The `eval:`
 * prefix is stripped.
 */

export interface EvalScope {
  doc: Record<string, unknown>;
  user?: Record<string, unknown>;
}

export interface EvalResult {
  value: boolean;
  error?: string;
}

type Value = unknown;
const WS = /\s/;

class Lexer {
  private i = 0;
  constructor(private src: string) {}

  done(): boolean {
    return this.i >= this.src.length;
  }
  skipWs(): void {
    while (!this.done() && WS.test(this.src[this.i]!)) this.i++;
  }
  match(s: string): boolean {
    this.skipWs();
    if (this.src.startsWith(s, this.i)) {
      this.i += s.length;
      return true;
    }
    return false;
  }
  expect(s: string): void {
    if (!this.match(s)) throw new Error(`expected "${s}" at ${this.i}`);
  }
  ident(): string | null {
    this.skipWs();
    const start = this.i;
    while (!this.done() && /[A-Za-z0-9_]/.test(this.src[this.i]!)) this.i++;
    return start === this.i ? null : this.src.slice(start, this.i);
  }
  number(): number | null {
    this.skipWs();
    const start = this.i;
    if (this.src[this.i] === '-') this.i++;
    while (!this.done() && /[0-9.]/.test(this.src[this.i]!)) this.i++;
    if (start === this.i || (start + 1 === this.i && this.src[start] === '-')) {
      this.i = start;
      return null;
    }
    const n = Number(this.src.slice(start, this.i));
    if (isNaN(n)) {
      this.i = start;
      return null;
    }
    return n;
  }
  string(): string | null {
    this.skipWs();
    const q = this.src[this.i];
    if (q !== "'" && q !== '"') return null;
    this.i++;
    const start = this.i;
    while (!this.done() && this.src[this.i] !== q) {
      if (this.src[this.i] === '\\') this.i++;
      this.i++;
    }
    const value = this.src.slice(start, this.i);
    if (this.src[this.i] === q) this.i++;
    return value;
  }
  pos(): number {
    return this.i;
  }
  rewind(i: number): void {
    this.i = i;
  }
}

function resolveScopePath(scope: EvalScope, root: 'doc' | 'user', path: string[]): Value {
  let cur: unknown = root === 'user' ? scope.user : scope.doc;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function isTruthy(v: Value): boolean {
  if (v === null || v === undefined || v === '' || v === 0 || v === false) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function equal(a: Value, b: Value): boolean {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  return a === b;
}

function compare(op: string, a: Value, b: Value): boolean {
  switch (op) {
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    case '<':
      return Number(a) < Number(b);
    case '<=':
      return Number(a) <= Number(b);
    case '>':
      return Number(a) > Number(b);
    case '>=':
      return Number(a) >= Number(b);
    case 'in':
      if (Array.isArray(b)) return b.some((x) => equal(x, a));
      if (typeof b === 'string') return String(a) ? b.includes(String(a)) : false;
      return false;
    case 'not in':
      if (Array.isArray(b)) return !b.some((x) => equal(x, a));
      if (typeof b === 'string') return !b.includes(String(a));
      return true;
  }
  return false;
}

function parsePrimary(lex: Lexer, scope: EvalScope): Value {
  lex.skipWs();
  if (lex.match('(')) {
    const v = parseOr(lex, scope);
    lex.expect(')');
    return v;
  }
  if (lex.match('[')) {
    const arr: unknown[] = [];
    if (!lex.match(']')) {
      arr.push(parsePrimary(lex, scope));
      while (lex.match(',')) arr.push(parsePrimary(lex, scope));
      lex.expect(']');
    }
    return arr;
  }
  if (lex.match('true')) return true;
  if (lex.match('false')) return false;
  if (lex.match('null')) return null;

  const saved = lex.pos();
  const s = lex.string();
  if (s !== null) return s;
  lex.rewind(saved);

  const n = lex.number();
  if (n !== null) return n;

  const id = lex.ident();
  if (id === 'doc' || id === 'user') {
    const path: string[] = [];
    while (lex.match('.')) {
      const seg = lex.ident();
      if (!seg) break;
      path.push(seg);
    }
    if (!path.length) return undefined;
    return resolveScopePath(scope, id, path);
  }
  if (id) return id; // bare identifier → string fallback (e.g. `Lead`)
  return undefined;
}

function parseCmp(lex: Lexer, scope: EvalScope): Value {
  const left = parsePrimary(lex, scope);
  lex.skipWs();
  for (const op of ['==', '!=', '<=', '>=', '<', '>', 'in', 'not in']) {
    if (lex.match(op)) {
      const right = parsePrimary(lex, scope);
      return compare(op, left, right);
    }
  }
  return left;
}

function parseNot(lex: Lexer, scope: EvalScope): Value {
  if (lex.match('!')) return !isTruthy(parseNot(lex, scope));
  return parseCmp(lex, scope);
}

function parseAnd(lex: Lexer, scope: EvalScope): Value {
  let v = isTruthy(parseNot(lex, scope));
  // Parse the rhs BEFORE the boolean combine — a `&&`/`||` short-circuit must not
  // skip token consumption (else `(a || b) && c` leaves the lexer mid-stream and
  // the enclosing `)` fails to match). This fixes a latent bug in the admin port.
  while (lex.match('&&')) {
    const rhs = isTruthy(parseNot(lex, scope));
    v = v && rhs;
  }
  return v;
}

function parseOr(lex: Lexer, scope: EvalScope): Value {
  let v = isTruthy(parseAnd(lex, scope));
  while (lex.match('||')) {
    const rhs = isTruthy(parseAnd(lex, scope));
    v = v || rhs;
  }
  return v;
}

/** Evaluate an expression, exposing parse errors so the caller owns the degrade direction. */
export function evaluateExpr(expr: string, scope: EvalScope): EvalResult {
  if (!expr) return { value: true };
  let src = expr.trim();
  if (src.startsWith('eval:')) src = src.slice(5).trim();

  // Fast paths: a bare `doc.field` / `user.field` is a truthy check.
  if (/^doc\.[A-Za-z0-9_]+$/.test(src)) return { value: isTruthy(scope.doc[src.slice(4)]) };
  if (/^user\.[A-Za-z0-9_]+$/.test(src)) return { value: isTruthy(scope.user?.[src.slice(5)]) };

  try {
    const lex = new Lexer(src);
    return { value: isTruthy(parseOr(lex, scope)) };
  } catch (e) {
    return { value: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Convenience boolean: parse errors degrade to `true` (back-compat with the admin port). */
export function evaluateSafe(expr: string, scope: EvalScope): boolean {
  const r = evaluateExpr(expr, scope);
  return r.error ? true : r.value;
}
