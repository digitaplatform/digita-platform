import type { Document } from "mongodb";

/** The parent field a rewritten $lookup joins on; removed right after it. */
export const JOIN_KEY = "__join_key";

/** A value as a list: a list as itself, anything else as the list of that one value. */
function asList(value: string): Document {
  return { $cond: [{ $isArray: value }, value, [value]] };
}

/**
 * The other stored form of an id: an ObjectId as its 24-hex text, a 24-hex text as its ObjectId,
 * anything else as itself. $convert, not $toObjectId: the optimizer may evaluate a branch a $switch
 * does not take, and $toObjectId of a text that is no id would fail the whole pipeline.
 */
function otherIdForm(value: string): Document {
  return {
    $switch: {
      branches: [
        { case: { $eq: [{ $type: value }, "objectId"] }, then: { $toString: value } },
        {
          case: { $eq: [{ $type: value }, "string"] },
          then: { $convert: { input: value, to: "objectId", onError: value, onNull: value } },
        },
      ],
      default: value,
    },
  };
}

/**
 * A concise $lookup (localField/foreignField) as the stages that join it by either stored form of
 * an id: the engine keeps a `system` _id as an ObjectId and a Link to it as its 24-hex text, and the
 * concise form compares stored types strictly, so the two never met. The parent first gets a key
 * field that holds each of its values, list elements one by one, in both forms; the $lookup joins
 * on that key, through the joined collection's index, and the key is removed after it. The
 * branches of a $facet are rewritten the same way; any other stage is returned as it is.
 */
export function joinByStoredIdForms(stage: Document): Document[] {
  const facet = stage["$facet"] as Record<string, Document[]> | undefined;
  if (facet && typeof facet === "object") {
    return [{ ...stage, $facet: Object.fromEntries(Object.entries(facet).map(([name, branch]) => [name, Array.isArray(branch) ? branch.flatMap(joinByStoredIdForms) : branch])) }];
  }
  const lookup = stage["$lookup"] as Document | undefined;
  if (!lookup || typeof lookup["localField"] !== "string" || typeof lookup["foreignField"] !== "string") return [stage];
  const local = `$${lookup["localField"]}`;
  const forms = { $concatArrays: [asList(local), { $map: { input: asList(local), as: "v", in: otherIdForm("$$v") } }] };
  return [{ $set: { [JOIN_KEY]: forms } }, { ...stage, $lookup: { ...lookup, localField: JOIN_KEY } }, { $unset: JOIN_KEY }];
}
