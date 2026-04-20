/**
 * Query module for path-based data access
 * Supports xpath-like syntax with location key matching
 *
 * Syntax:
 * - `key` - match exact key
 * - `*` - match any key
 * - `(*)` - iterate array elements
 * - `key[index]` - access array element at index
 * - `key["nested.key"]` - access nested key with dots in name
 * - `@field=value` - match object where field equals value
 * - `@field^=prefix` - match object where field starts with prefix
 * - `'key.with.dots'` - treat as single key (literal key containing dots)
 * - `\`key.with.dots\`` - treat as single key (alternative syntax)
 */

/**
 * Query result with path and value
 */
export interface QueryResult {
  path: string;
  value: unknown;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse location condition from path segment
 * e.g., "@Id=CapeBusStop" -> { field: "Id", value: "CapeBusStop", op: "=" }
 */
function parseLocationCondition(segment: string): {
  field: string;
  value: string;
  op: "=" | "^=";
} | null {
  if (!segment.startsWith("@")) {
    return null;
  }

  const rest = segment.slice(1);
  const eqMatch = rest.match(/^([^=]+)=(.*)$/);
  if (eqMatch) {
    return { field: eqMatch[1], value: eqMatch[2], op: "=" };
  }

  const prefixMatch = rest.match(/^([^=]+)\^=(.*)$/);
  if (prefixMatch) {
    return { field: prefixMatch[1], value: prefixMatch[2], op: "^=" };
  }

  // Just @field means field must be truthy
  return { field: rest, value: "", op: "=" };
}

/**
 * Check if an object matches a location condition
 */
function matchesCondition(obj: Record<string, unknown>, condition: ReturnType<typeof parseLocationCondition>): boolean {
  if (!condition) return false;

  const fieldValue = obj[condition.field];

  if (condition.op === "^=") {
    return typeof fieldValue === "string" && fieldValue.startsWith(condition.value);
  }

  if (condition.value === "") {
    // Just @field - value must be truthy
    return !!fieldValue;
  }

  return fieldValue === condition.value;
}

/**
 * Convert path segment to regex pattern and extract metadata
 */
function segmentToPattern(segment: string): {
  pattern: RegExp;
  isArray: boolean;
  locationCondition: ReturnType<typeof parseLocationCondition>;
  arrayIndex: number | null;
  quotedKey: string | null;
  baseKey: string;
} {
  // 如果用反引号包裹，这是整体 key（包含点的顶级 key）
  if (segment.startsWith("`") && segment.endsWith("`")) {
    const key = segment.slice(1, -1);
    return {
      pattern: new RegExp(`^${escapeRegex(key)}$`),
      isArray: false,
      locationCondition: null,
      arrayIndex: null,
      quotedKey: null,
      baseKey: key,
    };
  }

  let locationCondition = parseLocationCondition(segment);
  const isArray = segment.includes("(*)") || segment.startsWith("@");

  // Check for location condition inside parentheses: key(@field=value) or key(@field^=prefix)
  // This converts @Id=value to a quotedKey lookup
  let baseSegment = segment;
  let quotedKey: string | null = null;
  if (!locationCondition && segment.includes("(@")) {
    const parenMatch = segment.match(/^(.+?)\((@[^)]+)\)$/);
    if (parenMatch) {
      const [, key, conditionStr] = parenMatch;
      baseSegment = key;
      const cond = parseLocationCondition(conditionStr);
      if (cond && cond.op === "=" && cond.value !== "") {
        // @Id=value becomes a quotedKey lookup
        quotedKey = cond.value;
        locationCondition = null;
      } else {
        locationCondition = cond;
      }
    }
  }

  // Check for array index syntax: key[0] or key[*]
  const arrayIndexMatch = baseSegment.match(/^(.+?)\[(\d+|\*)\]$/);
  let patternStr: string;
  let arrayIndex: number | null = null;

  // Check for (*) wildcard syntax
  const hasParenWildcard = baseSegment.includes("(*)") || segment.includes("(*)");
  const segmentWithoutParen = hasParenWildcard ? baseSegment.replace(/\(\*\)/g, "") : baseSegment;

  if (arrayIndexMatch) {
    const [, key, index] = arrayIndexMatch;
    if (index === "*") {
      arrayIndex = -1; // -1 means wildcard
    } else {
      arrayIndex = parseInt(index);
    }
    patternStr = key;
  } else {
    // Check for quoted key syntax: key["nested.key"] or key['nested.key']
    const quotedKeyMatch = baseSegment.match(/^(.+?)\[([^\]]+)\]$/);
    if (quotedKeyMatch) {
      const [, key, extractedKey] = quotedKeyMatch;
      // Verify it's actually a quoted string (starts with " or ')
      if (extractedKey.startsWith('"') || extractedKey.startsWith("'")) {
        quotedKey = extractedKey.slice(1, -1); // Remove quotes
        patternStr = key;
      } else {
        patternStr = segmentWithoutParen;
      }
    } else {
      patternStr = segmentWithoutParen;
    }
  }

  // If (*) wildcard was used, set arrayIndex to -1 to trigger array iteration
  if (hasParenWildcard && arrayIndex === null) {
    arrayIndex = -1;
  }

  patternStr = patternStr
    .replace(/\*/g, "<<<STAR_WILDCARD>>>");        // *

  // Escape special regex chars (except * which is handled by wildcard replacement)
  patternStr = patternStr.replace(/[\[\]\{\}\(\)\?\\]/g, "\\$&");

  // Replace wildcard markers with actual regex
  patternStr = patternStr.replace(/<<<STAR_WILDCARD>>>/g, "[^.]*");

  return {
    pattern: new RegExp(`^${patternStr}$`),
    isArray,
    locationCondition,
    arrayIndex,
    quotedKey,
    baseKey: patternStr,
  };
}

/**
 * Split path by '.' but respect quoted/bracketed/parened sections
 * e.g., 'a.b["c.d"].e' -> ['a', 'b["c.d"]', 'e']'
 * e.g., 'Entries(@Id=value).Field' -> ['Entries(@Id=value)', 'Field']'
 */
function splitPath(pathPattern: string): string[] {
  // 如果用反引号包裹整个路径，当作一个完整的 key（不拆分）
  if (pathPattern.startsWith("`") && pathPattern.endsWith("`")) {
    return [pathPattern.slice(1, -1)];
  }

  const segments: string[] = [];
  let current = "";
  let inBracket = false;
  let inQuote = false;
  let inParen = false;
  let quoteChar = "";

  for (let i = 0; i < pathPattern.length; i++) {
    const char = pathPattern[i];

    if (inBracket) {
      current += char;
      if (char === "]") inBracket = false;
      continue;
    }

    if (inQuote) {
      current += char;
      if (char === quoteChar) inQuote = false;
      continue;
    }

    if (inParen) {
      current += char;
      if (char === ")") inParen = false;
      continue;
    }

    if (char === "[" || char === "\"") {
      if (char === "[") inBracket = true;
      else {
        inQuote = true;
        quoteChar = char;
      }
      current += char;
      continue;
    }

    if (char === "(") {
      inParen = true;
      current += char;
      continue;
    }

    if (char === ".") {
      if (current) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

/**
 * Query data using path pattern
 * Returns array of { path, value } for matching leaf values
 */
export function query(data: unknown, pathPattern: string): QueryResult[] {
  const results: QueryResult[] = [];
  const segments = splitPath(pathPattern);

  if (segments.length === 0) {
    return results;
  }

  queryRecursive(data, segments, "", results);
  return results;
}

function queryRecursive(
  data: unknown,
  segments: string[],
  currentPath: string,
  results: QueryResult[],
  forcedArrayIndex?: number | null
): void {
  if (data === null || data === undefined) return;

  // Helper function to collect all leaf values (strings/numbers/booleans) recursively
  function collectLeaves(data: unknown, path: string, results: QueryResult[]): void {
    if (data === null || data === undefined) return;
    if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
      results.push({ path, value: data });
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        collectLeaves(data[i], path ? `${path}[${i}]` : `[${i}]`, results);
      }
    } else if (typeof data === "object") {
      for (const key of Object.keys(data as Record<string, unknown>)) {
        collectLeaves((data as Record<string, unknown>)[key], path ? `${path}.${key}` : key, results);
      }
    }
  }

  // Base case: no more segments, collect all leaf values in this subtree
  if (segments.length === 0) {
    // If we have a forced array index, process elements
    if (forcedArrayIndex !== undefined && forcedArrayIndex !== null && typeof data === "object" && data !== null && Array.isArray(data)) {
      if (forcedArrayIndex === -1) {
        // Wildcard - iterate all elements
        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
          queryRecursive(item, [], itemPath, results);
        }
      } else if (forcedArrayIndex >= 0 && forcedArrayIndex < data.length) {
        // Specific index
        const item = data[forcedArrayIndex];
        const itemPath = currentPath ? `${currentPath}[${forcedArrayIndex}]` : `[${forcedArrayIndex}]`;
        queryRecursive(item, [], itemPath, results);
      }
      return;
    }
    collectLeaves(data, currentPath, results);
    return;
  }

  const [segment, ...restSegments] = segments;
  const { pattern, isArray, locationCondition, arrayIndex, quotedKey, baseKey } = segmentToPattern(segment);

  // Effective array index combines forced and parsed
  // - If forcedArrayIndex is set, use it (for recursive calls with specific index)
  // - Otherwise, if arrayIndex is >= 0 (specific index like [0]), use it
  // - If arrayIndex is -1 (wildcard (*)), use -1 to iterate all
  // - Otherwise (no index), use null
  const effectiveArrayIndex = forcedArrayIndex !== undefined && forcedArrayIndex !== null
    ? forcedArrayIndex
    : (arrayIndex >= 0 ? arrayIndex : (arrayIndex === -1 ? -1 : null));

  // Handle array data
  if (Array.isArray(data)) {
    // Determine which array indices to iterate
    const indices: number[] = [];
    if (effectiveArrayIndex !== null && effectiveArrayIndex >= 0) {
      // Specific index like Changes[0]
      if (effectiveArrayIndex < data.length) indices.push(effectiveArrayIndex);
    } else if (effectiveArrayIndex === -1) {
      // Wildcard (*) - iterate all
      for (let i = 0; i < data.length; i++) indices.push(i);
    }

    for (const i of indices) {
      const item = data[i];
      const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;

      if (typeof item === "object" && item !== null && locationCondition) {
        // Use location condition to filter
        if (matchesCondition(item as Record<string, unknown>, locationCondition)) {
          queryRecursive(item, arrayIndex >= 0 ? [] : restSegments, itemPath, results);
        }
      } else if (typeof item === "object" && item !== null) {
        queryRecursive(item, arrayIndex >= 0 ? [] : restSegments, itemPath, results);
      }
    }
    return;
  }

  // Handle object data
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    // If quotedKey is set, we need to look up baseKey first, then quotedKey inside it
    if (quotedKey !== null) {
      // First check if baseKey exists in obj
      if (!(baseKey in obj)) {
        return;
      }
      const baseValue = obj[baseKey];
      // Then check if quotedKey exists in baseValue
      if (!(quotedKey in (baseValue as Record<string, unknown>))) {
        return;
      }
      const basePath = currentPath ? `${currentPath}.${baseKey}` : baseKey;
      // Use bracket notation for keys with special characters
      const keyPath = `${basePath}["${quotedKey}"]`;
      const value = (baseValue as Record<string, unknown>)[quotedKey];
      if (restSegments.length === 0) {
        // At leaf level
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          results.push({ path: keyPath, value });
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          queryRecursive(value, [], keyPath, results);
        } else if (Array.isArray(value)) {
          queryRecursive(value, [], keyPath, results);
        }
      } else if (typeof value === "object" && value !== null) {
        queryRecursive(value, restSegments, keyPath, results);
      }
      return;
    }

    // Normal key iteration
    for (const key of keys) {
      if (!pattern.test(key)) continue;

      // Use bracket notation for keys with dots or special chars (only for nested paths)
      // For top-level keys (currentPath is empty), preserve the key as-is
      const keyPath = currentPath
        ? `${currentPath}.${key.includes(".") ? `["${key}"]` : key}`
        : key;
      let value = obj[key];

      // If current segment had array index, extract from array first
      if (effectiveArrayIndex !== null && Array.isArray(value)) {
        if (effectiveArrayIndex >= 0 && effectiveArrayIndex < value.length) {
          value = value[effectiveArrayIndex];
        } else if (effectiveArrayIndex === -1) {
          // Wildcard - iterate all array elements
          for (let i = 0; i < value.length; i++) {
            const itemPath = `${keyPath}[${i}]`;
            if (restSegments.length === 0) {
              // At leaf level for wildcard, collect leaves from each item
              queryRecursive(value[i], [], itemPath, results);
            } else {
              queryRecursive(value[i], restSegments, itemPath, results);
            }
          }
          continue;
        } else {
          continue; // Invalid index
        }
      }

      if (restSegments.length === 0) {
        // At leaf level
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          results.push({ path: keyPath, value });
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          queryRecursive(value, [], keyPath, results);
        } else if (Array.isArray(value)) {
          queryRecursive(value, [], keyPath, results, forcedArrayIndex ?? arrayIndex);
        }
      } else if (typeof value === "object" && value !== null) {
        queryRecursive(value, restSegments, keyPath, results);
      }
    }
  }
}

/**
 * Update value at path in data
 */
export function updateAtPath(
  data: unknown,
  path: string,
  newValue: unknown
): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  const segments = splitPath(path);
  if (segments.length === 0) {
    return newValue;
  }

  // Deep clone to avoid mutation
  const clone = JSON.parse(JSON.stringify(data));

  // For flat keys (key contains dots but is a top-level key), check if the path
  // literally exists as a key in the clone. If so, treat the entire path as the key.
  if (segments.length > 1 && path in (clone as Record<string, unknown>)) {
    (clone as Record<string, unknown>)[path] = newValue;
    return clone;
  }

  let current: unknown = clone;
  const lastIndex = segments.length - 1;

  for (let i = 0; i < lastIndex; i++) {
    const segment = segments[i];
    const arrayMatch = segment.match(/^(.+?)\[(\d+|\w+)\]$/);
    const quotedKeyMatch = segment.match(/^(.+?)\["([^"]+)"\]$/);

    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = (current as Record<string, unknown>)[key];
      if (Array.isArray(current)) {
        current = current[parseInt(index)];
      } else {
        current = (current as Record<string, unknown>)[index];
      }
    } else if (quotedKeyMatch) {
      const [, key, quotedKey] = quotedKeyMatch;
      current = (current as Record<string, unknown>)[key];
      current = (current as Record<string, unknown>)[quotedKey];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  const lastSegment = segments[lastIndex];
  const arrayMatch = lastSegment.match(/^(.+?)\[(\d+|\w+)\]$/);
  const quotedKeyMatch = lastSegment.match(/^(.+?)\["([^"]+)"\]$/);

  if (arrayMatch) {
    const [, key, index] = arrayMatch;
    if (Array.isArray((current as Record<string, unknown>)[key])) {
      (current as Record<string, unknown>)[key] = [...((current as Record<string, unknown>)[key] as unknown[])] as Record<string, unknown>;
      ((current as Record<string, unknown>)[key] as unknown[])[parseInt(index)] = newValue;
    } else {
      (current as Record<string, unknown>)[key] = newValue;
    }
  } else if (quotedKeyMatch) {
    const [, key, quotedKey] = quotedKeyMatch;
    (current as Record<string, unknown>)[key] = (current as Record<string, unknown>)[key] || {};
    ((current as Record<string, unknown>)[key] as Record<string, unknown>)[quotedKey] = newValue;
  } else {
    (current as Record<string, unknown>)[lastSegment] = newValue;
  }

  return clone;
}
