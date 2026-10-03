import type { ClientSession, Document, Filter } from "mongodb";
import { TREE_KIND_FIELD, TREE_MAX_DEPTH_DEFAULT, TREE_PARENT_FIELD, type EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { toIdStorage } from "../document/id-codec.js";
import { EngineError } from "../errors/engine-error.js";

/**
 * The keys the engine keeps on every node of a tree: the ids from the root down to its parent,
 * its level (a root is 1), and a counter every move raises on the node and on its new parent.
 * Two moves that would close a cycle between them (X under Y, Y under X) therefore both write X
 * and Y, so only one commits, and the other runs again and finds the cycle. A client's value for
 * them is never stored.
 */
export const TREE_ANCESTORS = "_ancestors";
export const TREE_DEPTH = "_depth";
export const TREE_REVISION = "_tree_rev";
const TREE_KEYS = [TREE_ANCESTORS, TREE_DEPTH, TREE_REVISION];

/** A write that would break the tree: a cycle, a parent of another tree, or a node too deep. */
export class TreeRefusedError extends EngineError {}

/** The fields whose value says which tree of the entity a node belongs to. */
function partitionFields(entity: EntityDefinition): string[] {
  return [...(entity.tree?.kind ? [TREE_KIND_FIELD] : []), ...(entity.tree?.menu === "website" ? ["site", "location"] : [])];
}

const idOf = (value: unknown): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : String(value);
const ancestorsOf = (row: Record<string, unknown>): string[] =>
  Array.isArray(row[TREE_ANCESTORS]) ? (row[TREE_ANCESTORS] as unknown[]).map(String) : [];
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Drops a client's values of the tree keys from a record's data: the engine writes them. */
export function dropTreeKeys(data: Record<string, unknown>, dirty?: Set<string>): void {
  for (const key of TREE_KEYS) {
    delete data[key];
    dirty?.delete(key);
  }
}

/** Where a node stands after a write: its ancestors from the root down, its level, and its parent. */
export interface TreePlacement {
  ancestors: string[];
  depth: number;
  parent: string | undefined;
}

/**
 * The place a write gives node `id` of a tree entity, or a refusal; `stored` is the node as stored
 * before the write, absent for an insert. Answers undefined when the write moves nothing. Every
 * read runs in `session`, so the write's transaction sees what it decides on.
 */
export async function placeTreeNode(
  db: MongoDBService,
  entity: EntityDefinition,
  id: string,
  values: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  session?: ClientSession,
): Promise<TreePlacement | undefined> {
  if (!entity.tree) return undefined;
  const params = (extra: Record<string, string> = {}) => ({ doctype: entity.label ?? entity.name, name: id, ...extra });
  const parentId = idOf(values[TREE_PARENT_FIELD]);
  const movedPartition = stored ? partitionFields(entity).find((f) => !sameValue(stored[f], values[f])) : undefined;
  if (stored && parentId === idOf(stored[TREE_PARENT_FIELD]) && !movedPartition) return undefined;

  const nodes = db.collection(entity.name, entity.database);
  if (movedPartition) {
    const hasChildren = (await nodes.countDocuments({ [TREE_PARENT_FIELD]: id }, { session, limit: 1 })) > 0;
    if (parentId || hasChildren) {
      throw new TreeRefusedError("tree_partition_root", params({ field: movedPartition }), 409, "TREE_PARTITION");
    }
  }

  let ancestors: string[] = [];
  if (parentId) {
    const parent = (await db.findOne(entity.name, parentId, entity.database, session)) as Record<string, unknown> | null;
    // The Link check refuses a parent that does not exist before this runs.
    if (!parent) throw new Error(`${entity.name} ${id}: its parent ${parentId} is not stored`);
    ancestors = [...ancestorsOf(parent), parentId];
    if (ancestors.includes(id)) {
      throw new TreeRefusedError("tree_cycle", params({ parent: parentId }), 409, "TREE_CYCLE");
    }
    const otherTree = partitionFields(entity).find((f) => !sameValue(parent[f], values[f]));
    if (otherTree) {
      throw new TreeRefusedError("tree_partition", params({ parent: parentId, field: otherTree }), 409, "TREE_PARTITION");
    }
  }

  const depth = ancestors.length + 1;
  // A node that moves takes its subtree along, so the deepest node below it must still fit.
  let below = 0;
  if (stored) {
    const [deepest] = await nodes
      .find({ [TREE_ANCESTORS]: id }, { session, projection: { [TREE_DEPTH]: 1 } })
      .sort({ [TREE_DEPTH]: -1 })
      .limit(1)
      .toArray();
    const storedDepth = typeof stored[TREE_DEPTH] === "number" ? (stored[TREE_DEPTH] as number) : ancestorsOf(stored).length + 1;
    if (deepest && typeof deepest[TREE_DEPTH] === "number") below = (deepest[TREE_DEPTH] as number) - storedDepth;
  }
  const max = entity.tree.max_depth ?? TREE_MAX_DEPTH_DEFAULT;
  if (depth + below > max) {
    throw new TreeRefusedError("tree_too_deep", params({ depth: String(depth + below), max: String(max) }), 409, "TREE_TOO_DEEP");
  }
  return { ancestors, depth, parent: parentId };
}

/**
 * Writes a node's place, raw and in `session`: its own keys, its subtree's ancestors and levels in
 * one update, and a raised revision on the node and on its new parent.
 */
export async function writeTreePlacement(
  db: MongoDBService,
  entity: EntityDefinition,
  id: string,
  placement: TreePlacement,
  session?: ClientSession,
): Promise<Record<string, unknown>> {
  const nodes = db.collection(entity.name, entity.database);
  const byId = (nodeId: string) => ({ _id: toIdStorage(nodeId) }) as unknown as Filter<Document>;
  const row = await nodes.findOneAndUpdate(
    byId(id),
    { $set: { [TREE_ANCESTORS]: placement.ancestors, [TREE_DEPTH]: placement.depth }, $inc: { [TREE_REVISION]: 1 } },
    { session, returnDocument: "after" },
  );
  if (placement.parent) await nodes.updateOne(byId(placement.parent), { $inc: { [TREE_REVISION]: 1 } }, { session });
  // Each node below keeps the part of its path below this node, behind this node's new path.
  const path = [...placement.ancestors, id];
  await db.updateMany(
    entity.name,
    { [TREE_ANCESTORS]: id },
    [
      {
        $set: {
          [TREE_ANCESTORS]: {
            $concatArrays: [{ $literal: path }, { $slice: [`$${TREE_ANCESTORS}`, { $add: [{ $indexOfArray: [`$${TREE_ANCESTORS}`, { $literal: id }] }, 1] }, 1000] }],
          },
        },
      },
      { $set: { [TREE_DEPTH]: { $add: [{ $size: `$${TREE_ANCESTORS}` }, 1] } } },
    ],
    entity.database,
    session,
  );
  return storedTreeKeys(row!);
}

/** The tree keys a stored node carries, for a writer that replaces the node whole and keeps its place. */
export function storedTreeKeys(stored: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(TREE_KEYS.filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]]));
}

/**
 * Sets `_ancestors` and `_depth` on every node of a tree entity whose stored ones differ from its
 * `parent` chain, for a writer that stores nodes raw, as the seed does. Validate every chain
 * before writing a placement, so an invalid seed never leaves a partially stamped tree.
 */
export async function restampTreeNodes(db: MongoDBService, entity: EntityDefinition): Promise<number> {
  if (!entity.tree) return 0;
  const nodes = db.collection(entity.name, entity.database);
  const partitions = partitionFields(entity);
  const projection = Object.fromEntries([TREE_PARENT_FIELD, TREE_ANCESTORS, TREE_DEPTH, ...partitions].map((key) => [key, 1]));
  const rows = await nodes.find({}, { projection }).toArray();
  const byId = new Map(rows.map((row) => [String(row["_id"]), row]));
  const placements = rows.map((row) => {
    const id = String(row["_id"]);
    const ancestors: string[] = [];
    const params = (extra: Record<string, string> = {}) => ({ doctype: entity.label ?? entity.name, name: id, ...extra });
    for (let up = idOf(row[TREE_PARENT_FIELD]); up; ) {
      if (up === id || ancestors.includes(up)) {
        throw new TreeRefusedError("tree_cycle", params({ parent: up }), 409, "TREE_CYCLE");
      }
      const parent = byId.get(up);
      if (!parent) throw new Error(`${entity.name} ${id}: its parent ${up} is not stored`);
      const otherTree = partitions.find((field) => !sameValue(row[field], parent[field]));
      if (otherTree) {
        throw new TreeRefusedError("tree_partition", params({ parent: up, field: otherTree }), 409, "TREE_PARTITION");
      }
      ancestors.unshift(up);
      up = idOf(parent[TREE_PARENT_FIELD]);
    }
    const depth = ancestors.length + 1;
    const max = entity.tree!.max_depth ?? TREE_MAX_DEPTH_DEFAULT;
    if (depth > max) {
      throw new TreeRefusedError("tree_too_deep", params({ depth: String(depth), max: String(max) }), 409, "TREE_TOO_DEEP");
    }
    return { row, ancestors, depth };
  });
  let written = 0;
  for (const { row, ancestors, depth } of placements) {
    if (sameValue(row[TREE_ANCESTORS], ancestors) && row[TREE_DEPTH] === depth) continue;
    await nodes.updateOne({ _id: row["_id"] } as Filter<Document>, { $set: { [TREE_ANCESTORS]: ancestors, [TREE_DEPTH]: depth } });
    written++;
  }
  return written;
}
