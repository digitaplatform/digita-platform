import { describe, expect, it } from "vitest";
import { activeRecordsFilter, activeRecordsPipeline } from "../src/record-reads.js";

describe("active record reads", () => {
  it("cannot override the audit guard with an ordinary caller's filter", () => {
    expect(activeRecordsFilter({ deleted: { $ne: null }, name: "A" })).toEqual({
      $and: [{ deleted: { $ne: null }, name: "A" }, { deleted: null }],
    });
    expect(activeRecordsFilter()).toEqual({ deleted: null });
  });

  it("keeps a text search in the first match and does not mutate the source", () => {
    const source = [{ $match: { $text: { $search: "bicycle" } } }, { $sort: { name: 1 } }];
    const before = structuredClone(source);
    expect(activeRecordsPipeline(source)).toEqual([
      { $match: { $and: [{ $text: { $search: "bicycle" } }, { deleted: null }] } },
      { $sort: { name: 1 } },
    ]);
    expect(source).toEqual(before);
  });

  it("keeps search first and filters its document results", () => {
    const first = { $search: { text: { query: "bicycle", path: "title" } } };
    expect(activeRecordsPipeline([first, { $limit: 3 }])).toEqual([first, { $match: { deleted: null } }, { $limit: 3 }]);
  });

  it("filters geoNear source records before output can overwrite the marker", () => {
    const near = { near: { type: "Point", coordinates: [0, 0] }, distanceField: "deleted", includeLocs: "deleted_by",
      query: { category: "book", deleted: { $ne: null } } };
    const source = [{ $geoNear: near }, { $limit: 3 }];
    const before = structuredClone(source);
    expect(activeRecordsPipeline(source)).toEqual([
      { $geoNear: { ...near, query: { $and: [near.query, { deleted: null }] } } }, source[1],
    ]);
    expect(activeRecordsPipeline([{ $geoNear: { distanceField: "deleted" } }])).toEqual([
      { $geoNear: { distanceField: "deleted", query: { deleted: null } } },
    ]);
    expect(source).toEqual(before);
  });

  it.each(["vectorSearch", "knnBeta"])("refuses the embedded search %s candidate limit", (key) => {
    expect(() => activeRecordsPipeline([{ $search: { [key]: { limit: 1 } } }])).toThrow("Search vector operators");
  });

  it.each([
    { $replaceWith: "$$SEARCH_META" },
    { $project: { count: "$$SEARCH_META.count" } },
    { $match: { $expr: { $gt: ["$$SEARCH_META.count.lowerBound", 0] } } },
    { $match: { $and: [{ title: "book" }, { $or: [{ $expr: { $gt: ["$$SEARCH_META.count.lowerBound", 0] } }] }] } },
    { $facet: { metadata: [{ $replaceRoot: { newRoot: "$$SEARCH_META" } }] } },
    { $lookup: { from: "Book", as: "books", let: { count: "$$SEARCH_META.count" }, pipeline: [] } },
    { $lookup: { from: "Book", as: "books", pipeline: [{ $replaceWith: "$$SEARCH_META" }] } },
  ])("refuses actual search metadata expressions in every nested read", (stage) => {
    expect(() => activeRecordsPipeline([{ $search: { text: { query: "book", path: "title" } } }, stage])).toThrow("Search metadata");
  });

  it("preserves literal search metadata strings", () => {
    const source = [{ $search: { text: { query: "$$SEARCH_META", path: "title" } } },
      { $match: { title: "$$SEARCH_META", nested: { $eq: "$$SEARCH_META" }, payload: { $eq: { $expr: "$$SEARCH_META" } } } },
      { $project: { title: { $literal: "$$SEARCH_META" }, constant: { $const: "$$SEARCH_META.count" } } }];
    expect(activeRecordsPipeline(source)).toEqual([source[0], { $match: { deleted: null } }, ...source.slice(1)]);
    expect(() => activeRecordsPipeline([{ $searchMeta: { count: { type: "total" } } }])).toThrow("Search metadata");
  });

  it("preserves literal vector filter strings and document comparison operands", () => {
    const filter = { category: { $eq: "$$SEARCH_META" }, payload: { $eq: { $expr: "$$SEARCH_META" } } };
    const vector = { index: "vectors", path: "embedding", queryVector: [1, 0], exact: true, limit: 1, filter };
    expect(activeRecordsPipeline([{ $vectorSearch: vector }])).toEqual([
      { $vectorSearch: { ...vector, filter: { $and: [filter, { $nor: [{ deleted: { $ne: null } }] }] } } },
      { $match: { deleted: null } },
    ]);
    expect(activeRecordsPipeline([{ $match: { $and: [{ payload: { $eq: { $expr: "$$SEARCH_META" } } }] } }])).toEqual([
      { $match: { $and: [{ $and: [{ payload: { $eq: { $expr: "$$SEARCH_META" } } }] }, { deleted: null }] } },
    ]);
  });

  it.each(["$search", "$vectorSearch"])("refuses %s stored sources that can hide or stale the deletion marker", (key) => {
    expect(() => activeRecordsPipeline([{ [key]: { returnStoredSource: true } }])).toThrow("Stored search sources");
  });

  it.each(["count", "facet"])("refuses search %s metadata that includes marked records", (key) => {
    expect(() => activeRecordsPipeline([{ $search: { [key]: {} } }])).toThrow("Search metadata");
  });

  it("excludes deleted vector candidates before the result limit without overriding the caller or changing input", () => {
    const source = [{ $vectorSearch: { index: "vectors", path: "embedding", queryVector: [1, 0], exact: true, limit: 1,
      filter: { category: "book", deleted: { $ne: null } } } }];
    const before = structuredClone(source);
    expect(activeRecordsPipeline(source)).toEqual([
      { $vectorSearch: { ...source[0]!.$vectorSearch, filter: { $and: [source[0]!.$vectorSearch.filter, { $nor: [{ deleted: { $ne: null } }] }] } } },
      { $match: { deleted: null } },
    ]);
    expect(source).toEqual(before);
    expect((activeRecordsPipeline([{ $vectorSearch: { limit: 1 } }])[0]!.$vectorSearch as Record<string, unknown>).filter)
      .toEqual({ $nor: [{ deleted: { $ne: null } }] });
  });

  it("keeps literal-document sources first while guarding collection joins within them", () => {
    const literal = { $documents: [{ x: 1, deleted: "a literal value" }] };
    const source = [{ $lookup: { as: "constants", pipeline: [literal, { $lookup: { from: "Book", as: "books", pipeline: [] } }] } },
      { $unionWith: { pipeline: [literal, { $unionWith: "Book" }] } }];
    const before = structuredClone(source);
    expect(activeRecordsPipeline(source)).toEqual([
      { $match: { deleted: null } },
      { $lookup: { as: "constants", pipeline: [literal, { $lookup: { from: "Book", as: "books", pipeline: [{ $match: { deleted: null } }] } }] } },
      { $unionWith: { pipeline: [literal, { $unionWith: { coll: "Book", pipeline: [{ $match: { deleted: null } }] } }] } },
    ]);
    expect(activeRecordsPipeline([literal])).toEqual([literal]);
    expect(source).toEqual(before);
  });

  it("guards joined collections recursively while facets retain projected input", () => {
    const source = [{ $project: { deleted: 0 } }, { $facet: {
      rows: [{ $lookup: { from: "Invoice", localField: "_id", foreignField: "sale", as: "invoices", pipeline: [
        { $unionWith: "Credit" }, { $graphLookup: { from: "Part", restrictSearchWithMatch: { active: true } } },
      ] } }],
      count: [{ $count: "total" }],
    } }];
    const before = structuredClone(source);
    expect(activeRecordsPipeline(source)).toEqual([
      { $match: { deleted: null } }, source[0], { $facet: {
        rows: [{ $lookup: { from: "Invoice", localField: "_id", foreignField: "sale", as: "invoices", pipeline: [
          { $match: { deleted: null } },
          { $unionWith: { coll: "Credit", pipeline: [{ $match: { deleted: null } }] } },
          { $graphLookup: { from: "Part", restrictSearchWithMatch: { $and: [{ active: true }, { deleted: null }] } } },
        ] } }],
        count: [{ $count: "total" }],
      } },
    ]);
    expect(source).toEqual(before);
  });
});
