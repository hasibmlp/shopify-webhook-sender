export function projectToShape(
  reference: any,
  source: any,
  opts: { strict?: boolean; identityKeys?: string[] } = {}
): any {
  const {
    strict = false,
    identityKeys = [
      "id",
      "admin_graphql_api_id",
      "variant_id",
      "product_id",
    ],
  } = opts;

  if (reference === null || reference === undefined) {
    return null;
  }

  // If the source is null, we need to build a null-shaped object based on the reference.
  if (source === null || source === undefined) {
    if (Array.isArray(reference)) {
      return [];
    }
    // If the reference is a primitive, return null. This is the base case.
    if (typeof reference !== "object") {
      return null;
    }
    // If the reference is an object, recursively build a null-shaped object.
    const result: { [key: string]: any } = {};
    for (const key in reference) {
      if (Object.prototype.hasOwnProperty.call(reference, key)) {
        result[key] = projectToShape(reference[key], null, opts);
      }
    }
    return result;
  }

  if (Array.isArray(reference)) {
    if (!Array.isArray(source)) {
      if (strict) {
        throw new Error(
          `Schema mismatch: expected an array in source, but got ${typeof source}`
        );
      }
      return [];
    }

    const sourceMap = source.reduce((map: Map<any, any>, item: any) => {
      if (typeof item === "object" && item !== null) {
        for (const key of identityKeys) {
          if (key in item && item[key] != null) {
            map.set(item[key], item);
            return map;
          }
        }
      }
      return map;
    }, new Map<any, any>());

    let sourceIndex = 0;
    return reference.map((refItem: any) => {
      let sourceItem: any = null;
      if (typeof refItem === "object" && refItem !== null) {
        for (const key of identityKeys) {
          if (key in refItem && sourceMap.has(refItem[key])) {
            sourceItem = sourceMap.get(refItem[key]);
            break;
          }
        }
      }
      if (sourceItem === null) {
        sourceItem = source[sourceIndex++];
      }
      return projectToShape(refItem, sourceItem, opts);
    });
  }

  if (typeof reference === "object") {
    const result: { [key: string]: any } = {};
    for (const key in reference) {
      if (Object.prototype.hasOwnProperty.call(reference, key)) {
        if (!(key in source)) {
          if (strict) {
            throw new Error(
              `Schema mismatch: key "${key}" not found in source object.`
            );
          }
          result[key] = projectToShape(reference[key], null, opts);
        } else {
          result[key] = projectToShape(reference[key], source[key], opts);
        }
      }
    }
    return result;
  }

  return source;
}
