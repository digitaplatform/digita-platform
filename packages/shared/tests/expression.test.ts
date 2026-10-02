import { describe, expect, it } from "vitest";
import {
  ExpressionError,
  evaluateNode,
  identifiersOf,
  isTruthy,
  parseExpression,
  rootFieldsOf,
  stripEvalPrefix,
} from "../src/index.js";

function run(expression: string, doc: Record<string, unknown> = {}, user: Record<string, unknown> = {}): unknown {
  return evaluateNode(parseExpression(expression), (name) => {
    if (name === "doc") return doc;
    if (name === "user") return user;
    throw new ExpressionError(`unknown identifier ${name}`);
  });
}

describe("parseExpression", () => {
  it("reads the whole input, so text after a complete expression is an error", () => {
    expect(() => parseExpression("doc.status = 'Closed'")).toThrow(ExpressionError);
    expect(() => parseExpression("doc.status == On hold")).toThrow(ExpressionError);
    expect(() => parseExpression("doc.a doc.b")).toThrow(ExpressionError);
    expect(() => parseExpression("doc.status == 'Closed'  ")).not.toThrow();
  });

  it("refuses broken input", () => {
    for (const broken of ["", "(doc.x", "doc.x ==", "'open", "doc[0]", "doc.x & 1", "doc.f()", "`x`", "1abc", "doc.", "in", "a ? b"]) {
      expect(() => parseExpression(broken), broken).toThrow(ExpressionError);
    }
  });

  it("refuses a member that reaches a prototype or a constructor", () => {
    for (const member of ["constructor", "prototype", "__proto__", "__defineGetter__"]) {
      expect(() => parseExpression(`doc.${member}`), member).toThrow(ExpressionError);
    }
    expect(() => parseExpression("doc.constructor_name")).not.toThrow();
  });

  it("binds operators as JavaScript does", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("!doc.a == true", { a: 0 })).toBe(true);
    expect(run("doc.a || doc.b && doc.c", { a: 1, b: 0, c: 1 })).toBe(1);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("doc.x > 1 ? 'big' : 'small'", { x: 2 })).toBe("big");
    expect(run("doc.a ? doc.b ? 1 : 2 : 3", { a: true, b: false })).toBe(2);
  });
});

describe("evaluateNode", () => {
  it("compares as JavaScript does", () => {
    expect(run("doc.qty == 5", { qty: "5" })).toBe(true);
    expect(run("doc.qty === 5", { qty: "5" })).toBe(false);
    expect(run("doc.qty !== 5", { qty: "5" })).toBe(true);
    expect(run("doc.flag == true", { flag: 1 })).toBe(true);
    expect(run("doc.missing == null")).toBe(true);
    expect(run("doc.day < '2024-02-01'", { day: "2024-01-15" })).toBe(true);
    expect(run("doc.qty * doc.price % 7", { qty: 3, price: 4 })).toBe(5);
    expect(run("-doc.qty + +'2'", { qty: 3 })).toBe(-1);
  });

  it("reads a missing field as null", () => {
    expect(run("doc.missing")).toBe(null);
    expect(run("doc.a.b")).toBe(null);
    expect(run("doc.qty * 5")).toBe(0);
  });

  it("tests membership with in and not in", () => {
    expect(run("doc.kind in ['a', 'b']", { kind: "b" })).toBe(true);
    expect(run("doc.kind in ['a', 'b']", { kind: "c" })).toBe(false);
    expect(run("doc.kind not in ['a', 'b']", { kind: "c" })).toBe(true);
    expect(run("doc.qty in [1, 2]", { qty: "2" })).toBe(true);
    expect(run("'ell' in doc.word", { word: "hello" })).toBe(true);
    expect(run("'' in doc.word", { word: "hello" })).toBe(false);
    expect(run("'x' in doc.tags")).toBe(false);
    expect(run("'x' not in doc.tags")).toBe(true);
  });

  it("treats an empty list as false wherever it tests truth", () => {
    expect(run("!doc.items", { items: [] })).toBe(true);
    expect(run("doc.items && 'yes'", { items: [] })).toEqual([]);
    expect(run("doc.items ? 1 : 2", { items: [] })).toBe(2);
    expect(run("!doc.items", { items: [1] })).toBe(false);
  });

  it("short-circuits && and ||, so an operand it does not need is never resolved", () => {
    const strict = (name: string) => {
      if (name === "doc") return { a: true };
      throw new ExpressionError(`unknown identifier ${name}`);
    };
    expect(evaluateNode(parseExpression("doc.a || secret.b"), strict)).toBe(true);
    expect(() => evaluateNode(parseExpression("!doc.a || secret.b"), strict)).toThrow(ExpressionError);
  });

  it("unescapes string literals", () => {
    expect(run("'it\\'s'")).toBe("it's");
    expect(run('"a\\nb"')).toBe("a\nb");
  });
});

describe("helpers", () => {
  it("names the identifiers an expression reads", () => {
    expect([...identifiersOf(parseExpression("doc.a == user.b || row.c"))].sort()).toEqual(["doc", "row", "user"]);
  });

  it("names the root fields an expression reads, and nothing when it reads the root whole", () => {
    expect(rootFieldsOf(parseExpression("doc.a == 1 && doc.b.c && user.d"), "doc")).toEqual(["a", "b"]);
    expect(rootFieldsOf(parseExpression("doc.a && doc"), "doc")).toBeUndefined();
    expect(rootFieldsOf(parseExpression("user.a"), "doc")).toEqual([]);
  });

  it("strips the eval: prefix", () => {
    expect(stripEvalPrefix(" eval: doc.a ")).toBe("doc.a");
    expect(stripEvalPrefix("doc.a")).toBe("doc.a");
  });

  it("knows which values are false", () => {
    for (const value of [null, undefined, "", 0, false, []]) expect(isTruthy(value), String(value)).toBe(false);
    for (const value of ["0", 1, true, [0], {}]) expect(isTruthy(value), String(value)).toBe(true);
  });
});

describe("parseExpression — bounded input", () => {
  it.each([
    ["1,000 nested parentheses", `${"(".repeat(1000)}doc.a${")".repeat(1000)}`],
    ["1,000 nested lists", `${"[".repeat(1000)}1${"]".repeat(1000)}`],
    ["1,000 prefix operators", `${"!".repeat(1000)}doc.a`],
    ["100 nested ternaries", `${"doc.a ? 1 : ".repeat(100)}0`],
    ["a source of 5,000 characters", `doc.a${" + 1".repeat(1249)}`],
  ])("refuses %s with ExpressionError, not a stack overflow", (_what, source) => {
    expect(() => parseExpression(source)).toThrow(ExpressionError);
  });

  it("PLANTED INNOCENT: parses 64 levels and a source of 4,096 characters", () => {
    expect(() => parseExpression(`${"(".repeat(63)}doc.a${")".repeat(63)}`)).not.toThrow();
    const long = `doc.a${" + 1".repeat(1022)}`;
    expect(long.length).toBeLessThanOrEqual(4096);
    expect(() => parseExpression(long)).not.toThrow();
  });
});
