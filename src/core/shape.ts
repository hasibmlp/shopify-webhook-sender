export function projectToShape(
  reference: any,
  source: any,
  opts: { strict?: boolean; identityKeys?: string[] } = {}
): any {
  const {
    strict = false,
    identityKeys = ["id", "admin_graphql_api_id", "variant_id", "product_id"],
  } = opts;

  // The definitive base case: if the reference is not a complex object (i.e., it's a primitive like null, string, number),
  // it acts as a placeholder. We should take the corresponding value from the source.
  if (typeof reference !== 'object' || reference === null) {
    return source;
  }

  // If the reference is an object, but the source is not, we must construct a null-shaped object.
  if (typeof source !== 'object' || source === null) {
    if (Array.isArray(reference)) {
      return []; // Match array type with an empty array
    }
    // Recursively build a null-shaped object based on the reference keys
    const nullShapedResult: { [key: string]: any } = {};
    for (const key in reference) {
      if (Object.prototype.hasOwnProperty.call(reference, key)) {
        nullShapedResult[key] = projectToShape(reference[key], null, opts);
      }
    }
    return nullShapedResult;
  }
  
  // If both reference and source are arrays, map them. This is critical for line_items.
  if (Array.isArray(reference)) {
    // If source is not an array, we can't map it. Return an empty array.
    if (!Array.isArray(source)) {
      if (strict) {
        throw new Error(`Schema mismatch: expected an array in source, but got ${typeof source}`);
      }
      return [];
    }

    // The reference array often contains just one example object. We use its keys to shape every object from the source array.
    const referenceItemShape = reference[0];
    if (!referenceItemShape) {
      // If the reference array is empty (e.g., "tracking_numbers": []), return the source array as-is.
      return source;
    }
    
    // Recursively shape each item from the source array using the reference item's shape.
    return source.map((sourceItem: any) => projectToShape(referenceItemShape, sourceItem, opts));
  }

  // If both are objects, this is the core logic.
  // We iterate over the *source* keys to ensure we capture all available data.
  // We only include a key if it also exists in the *reference* to maintain the shape.
  const result: { [key: string]: any } = {};
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key) && Object.prototype.hasOwnProperty.call(reference, key)) {
      // Recurse to handle nested structures.
      result[key] = projectToShape(reference[key], source[key], opts);
    }
  }
  // Finally, ensure any keys that are in the reference but *not* in the source are added as null-shaped objects.
  for (const key in reference) {
    if (Object.prototype.hasOwnProperty.call(reference, key) && !Object.prototype.hasOwnProperty.call(source, key)) {
      if (strict) {
        throw new Error(`Schema mismatch: key "${key}" not found in source object.`);
      }
      result[key] = projectToShape(reference[key], null, opts);
    }
  }
  return result;
}
