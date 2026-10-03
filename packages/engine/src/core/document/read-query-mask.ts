import type { Document } from "mongodb";
import { normalizeIdFilterValue } from "./id-codec.js";

/** The stored-row field mask, before a query compares values hidden from a shared reader. */
export function readQueryMask(fields: ReadonlySet<string>, tables: ReadonlyMap<string, ReadonlySet<string>>, value: unknown = "$$ROOT"): Document {
  const visible = { $filter: {
    input: { $objectToArray: value }, as: "entry",
    cond: { $or: [{ $in: ["$$entry.k", { $literal: [...fields] }] }, { $eq: [{ $substrCP: ["$$entry.k", 0, 1] }, "_"] }] },
  } };
  if (tables.size === 0) return { $arrayToObject: visible };
  return { $arrayToObject: { $map: {
    input: visible, as: "entry",
    in: { k: "$$entry.k", v: { $switch: {
      branches: [...tables].map(([table, children]) => ({
        case: { $eq: ["$$entry.k", table] },
        then: { $cond: [{ $isArray: "$$entry.v" }, { $map: {
          input: "$$entry.v", as: "child", in: { $switch: { branches: [
            { case: { $eq: [{ $type: "$$child" }, "object"] }, then: readQueryMask(children, new Map(), "$$child") },
            { case: { $isArray: "$$child" }, then: readQueryMask(children, new Map(), { $arrayToObject: { $map: {
              input: { $range: [0, { $size: "$$child" }] }, as: "index",
              in: { k: { $toString: "$$index" }, v: { $arrayElemAt: ["$$child", "$$index"] } },
            } } }) },
          ], default: {} } },
        } }, "$$entry.v"] },
      })),
      default: "$$entry.v",
    } } },
  } } };
}

/** The aggregate path uses the same native ID normalization as database find/count. */
export function storedIdFilter(filter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filter).map(([key, value]) => [key,
    key === "_id" ? normalizeIdFilterValue(value)
      : ["$and", "$or", "$nor"].includes(key) && Array.isArray(value)
        ? value.map((part) => storedIdFilter(part as Record<string, unknown>)) : value,
  ]));
}
