/**
 * The one expression grammar of a field's depends_on, mandatory_depends_on and
 * read_only_depends_on, and of the other conditions the form and the engine both
 * judge. The form and the engine parse and evaluate through this module, so an
 * expression means the same on both sides or fails on both.
 *
 * Hand-written recursive descent with no `eval`; identifiers are resolved by the
 * caller, so each caller decides which roots exist.
 *
 *   expr      := ternary
 *   ternary   := or ( "?" ternary ":" ternary )?
 *   or        := and ( "||" and )*
 *   and       := equality ( "&&" equality )*
 *   equality  := relation ( ("===" | "!==" | "==" | "!=") relation )*
 *   relation  := additive ( ("<=" | ">=" | "<" | ">" | "in" | "not in") additive )*
 *   additive  := term ( ("+" | "-") term )*
 *   term      := unary ( ("*" | "/" | "%") unary )*
 *   unary     := ("!" | "-" | "+") unary | member
 *   member    := primary ( "." name )*
 *   primary   := number | string | "true" | "false" | "null" | "undefined"
 *              | name | "(" expr ")" | "[" ( expr ( "," expr )* )? "]"
 *
 * The whole input must be read: text left after a complete expression is an error.
 * A member that reaches a prototype or a constructor is an error too.
 */

export type ExprBinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not in"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type ExprUnaryOperator = "!" | "-" | "+";

export type ExprNode =
  | { type: "Literal"; value: string | number | boolean | null | undefined }
  | { type: "Identifier"; name: string }
  | { type: "Member"; object: ExprNode; property: string }
  | { type: "Array"; elements: ExprNode[] }
  | { type: "Unary"; operator: ExprUnaryOperator; argument: ExprNode }
  | { type: "Binary"; operator: ExprBinaryOperator; left: ExprNode; right: ExprNode }
  | { type: "Conditional"; test: ExprNode; consequent: ExprNode; alternate: ExprNode };

/** Resolves a bare identifier such as `doc` or `user` to its value, or throws. */
export type ExprIdentifierResolver = (name: string) => unknown;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

/** Members that would reach an object's prototype or its constructor. */
const FORBIDDEN_MEMBERS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

type Token =
  | { kind: "number"; value: number; at: number }
  | { kind: "string"; value: string; at: number }
  | { kind: "name"; value: string; at: number }
  | { kind: "punct"; value: string; at: number }
  | { kind: "end"; at: number };

// Longest first, so `===` is never read as `==` followed by `=`.
const PUNCTUATORS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "<", ">", "!", "+", "-", "*", "/", "%", "(", ")", "[", "]", ",", ".", "?", ":"];

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const match = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      i += match[0].length;
      if (/[A-Za-z_$]/.test(src[i] ?? "")) throw new ExpressionError(`unexpected "${src[i]}" at ${i}`);
      tokens.push({ kind: "number", value: Number(match[0]), at });
      continue;
    }
    if (ch === "'" || ch === '"') {
      let value = "";
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") {
          i++;
          if (i >= src.length) break;
          const escaped = src[i]!;
          value += ESCAPES[escaped] ?? escaped;
        } else {
          value += src[i];
        }
        i++;
      }
      if (i >= src.length) throw new ExpressionError(`unterminated string at ${at}`);
      i++;
      tokens.push({ kind: "string", value, at });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      i += match[0].length;
      tokens.push({ kind: "name", value: match[0], at });
      continue;
    }
    const punct = PUNCTUATORS.find((p) => src.startsWith(p, i));
    if (!punct) throw new ExpressionError(`unexpected "${ch}" at ${i}`);
    i += punct.length;
    tokens.push({ kind: "punct", value: punct, at });
  }
  tokens.push({ kind: "end", at: src.length });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly src: string,
    private readonly tokens: Token[],
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private isPunct(value: string): boolean {
    const t = this.peek();
    return t.kind === "punct" && t.value === value;
  }

  private isName(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "name" && t.value === value;
  }

  private fail(t: Token): never {
    if (t.kind === "end") throw new ExpressionError(`unexpected end of expression at ${t.at}`);
    throw new ExpressionError(`unexpected "${this.src.slice(t.at)}" at ${t.at}`);
  }

  private expectPunct(value: string): void {
    if (!this.isPunct(value)) this.fail(this.peek());
    this.pos++;
  }

  parse(): ExprNode {
    const node = this.ternary();
    if (this.peek().kind !== "end") this.fail(this.peek());
    return node;
  }

  private ternary(): ExprNode {
    const test = this.or();
    if (!this.isPunct("?")) return test;
    this.pos++;
    const consequent = this.ternary();
    this.expectPunct(":");
    const alternate = this.ternary();
    return { type: "Conditional", test, consequent, alternate };
  }

  private binaryLevel(next: () => ExprNode, operators: string[]): ExprNode {
    let left = next();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "punct" || !operators.includes(t.value)) return left;
      this.pos++;
      left = { type: "Binary", operator: t.value as ExprBinaryOperator, left, right: next() };
    }
  }

  private or(): ExprNode {
    return this.binaryLevel(() => this.and(), ["||"]);
  }

  private and(): ExprNode {
    return this.binaryLevel(() => this.equality(), ["&&"]);
  }

  private equality(): ExprNode {
    return this.binaryLevel(() => this.relation(), ["===", "!==", "==", "!="]);
  }

  private relation(): ExprNode {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      let operator: ExprBinaryOperator;
      if (t.kind === "punct" && ["<=", ">=", "<", ">"].includes(t.value)) {
        operator = t.value as ExprBinaryOperator;
        this.pos++;
      } else if (this.isName("in")) {
        operator = "in";
        this.pos++;
      } else if (this.isName("not") && this.isName("in", 1)) {
        operator = "not in";
        this.pos += 2;
      } else {
        return left;
      }
      left = { type: "Binary", operator, left, right: this.additive() };
    }
  }

  private additive(): ExprNode {
    return this.binaryLevel(() => this.term(), ["+", "-"]);
  }

  private term(): ExprNode {
    return this.binaryLevel(() => this.unary(), ["*", "/", "%"]);
  }

  private unary(): ExprNode {
    const t = this.peek();
    if (t.kind === "punct" && (t.value === "!" || t.value === "-" || t.value === "+")) {
      this.pos++;
      return { type: "Unary", operator: t.value as ExprUnaryOperator, argument: this.unary() };
    }
    return this.member();
  }

  private member(): ExprNode {
    let node = this.primary();
    while (this.isPunct(".")) {
      this.pos++;
      const t = this.peek();
      if (t.kind !== "name") this.fail(t);
      if (FORBIDDEN_MEMBERS.has(t.value)) throw new ExpressionError(`forbidden member "${t.value}" at ${t.at}`);
      this.pos++;
      node = { type: "Member", object: node, property: t.value };
    }
    return node;
  }

  private primary(): ExprNode {
    const t = this.peek();
    if (t.kind === "number" || t.kind === "string") {
      this.pos++;
      return { type: "Literal", value: t.value };
    }
    if (t.kind === "name") {
      // `in` and `not` only join two operands; as an operand they mean an unquoted word.
      if (t.value === "in" || (t.value === "not" && this.isName("in", 1))) this.fail(t);
      this.pos++;
      switch (t.value) {
        case "true":
          return { type: "Literal", value: true };
        case "false":
          return { type: "Literal", value: false };
        case "null":
          return { type: "Literal", value: null };
        case "undefined":
          return { type: "Literal", value: undefined };
      }
      return { type: "Identifier", name: t.value };
    }
    if (this.isPunct("(")) {
      this.pos++;
      const node = this.ternary();
      this.expectPunct(")");
      return node;
    }
    if (this.isPunct("[")) {
      this.pos++;
      const elements: ExprNode[] = [];
      if (!this.isPunct("]")) {
        elements.push(this.ternary());
        while (this.isPunct(",")) {
          this.pos++;
          elements.push(this.ternary());
        }
      }
      this.expectPunct("]");
      return { type: "Array", elements };
    }
    this.fail(t);
  }
}

/** Parse an expression; throws `ExpressionError` on any text the grammar does not read. */
export function parseExpression(source: string): ExprNode {
  return new Parser(source, tokenize(source)).parse();
}

/** Strip the optional `eval:` prefix a field expression may carry. */
export function stripEvalPrefix(expression: string): string {
  const src = expression.trim();
  return src.startsWith("eval:") ? src.slice(5).trim() : src;
}

/** An empty string, zero, false, null, undefined and an empty list are false. */
export function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === 0 || value === false) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function isMember(item: unknown, list: unknown): boolean {
  if (Array.isArray(list)) return list.some((x) => x == item);
  if (typeof list === "string" && (typeof item === "string" || typeof item === "number")) {
    return String(item) !== "" && list.includes(String(item));
  }
  return false;
}

function binary(operator: ExprBinaryOperator, left: unknown, right: unknown): unknown {
  // Operands are compared and combined as JavaScript does, so a value the engine stores
  // and a value the form holds give the same result: a Check holds 1 or true alike.
  const a = left as number;
  const b = right as number;
  switch (operator) {
    case "==":
      return left == right;
    case "!=":
      return left != right;
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "in":
      return isMember(left, right);
    case "not in":
      return !isMember(left, right);
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "%":
      return a % b;
  }
  throw new ExpressionError(`unknown operator ${String(operator)}`);
}

/** Evaluate a parsed expression to its raw value. */
export function evaluateNode(node: ExprNode, resolveIdentifier: ExprIdentifierResolver): unknown {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "Identifier":
      return resolveIdentifier(node.name);
    case "Member": {
      const object = evaluateNode(node.object, resolveIdentifier);
      if (object === null || object === undefined) return null;
      const value = (object as Record<string, unknown>)[node.property];
      // A missing field reads as null, so `doc.qty * 5` with no qty is 0, not NaN.
      return value === undefined ? null : value;
    }
    case "Array":
      return node.elements.map((element) => evaluateNode(element, resolveIdentifier));
    case "Unary": {
      const value = evaluateNode(node.argument, resolveIdentifier);
      if (node.operator === "!") return !isTruthy(value);
      return node.operator === "-" ? -(value as number) : +(value as number);
    }
    case "Binary": {
      const left = evaluateNode(node.left, resolveIdentifier);
      if (node.operator === "&&") return isTruthy(left) ? evaluateNode(node.right, resolveIdentifier) : left;
      if (node.operator === "||") return isTruthy(left) ? left : evaluateNode(node.right, resolveIdentifier);
      return binary(node.operator, left, evaluateNode(node.right, resolveIdentifier));
    }
    case "Conditional":
      return isTruthy(evaluateNode(node.test, resolveIdentifier))
        ? evaluateNode(node.consequent, resolveIdentifier)
        : evaluateNode(node.alternate, resolveIdentifier);
  }
}

/** Every node of a parsed expression, in no particular order. */
function* nodesOf(node: ExprNode): Generator<ExprNode> {
  yield node;
  switch (node.type) {
    case "Member":
      yield* nodesOf(node.object);
      break;
    case "Array":
      for (const element of node.elements) yield* nodesOf(element);
      break;
    case "Unary":
      yield* nodesOf(node.argument);
      break;
    case "Binary":
      yield* nodesOf(node.left);
      yield* nodesOf(node.right);
      break;
    case "Conditional":
      yield* nodesOf(node.test);
      yield* nodesOf(node.consequent);
      yield* nodesOf(node.alternate);
      break;
  }
}

/** The identifiers an expression reads, so a caller can refuse roots it does not offer. */
export function identifiersOf(node: ExprNode): Set<string> {
  const names = new Set<string>();
  for (const n of nodesOf(node)) if (n.type === "Identifier") names.add(n.name);
  return names;
}

/**
 * The fields of `root` an expression reads directly, as in `doc.status`; `undefined` when it
 * reads the root as a whole, so the caller cannot name them.
 */
export function rootFieldsOf(node: ExprNode, root: string): string[] | undefined {
  const fields = new Set<string>();
  const memberObjects = new Set<ExprNode>();
  for (const n of nodesOf(node)) {
    if (n.type === "Member" && n.object.type === "Identifier" && n.object.name === root) {
      fields.add(n.property);
      memberObjects.add(n.object);
    }
  }
  for (const n of nodesOf(node)) {
    if (n.type === "Identifier" && n.name === root && !memberObjects.has(n)) return undefined;
  }
  return [...fields];
}
