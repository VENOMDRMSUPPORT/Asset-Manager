/**
 * Response Normalizer — makes the agent loop tolerant of real-world model output.
 *
 * Common variations handled:
 *  1. A single valid JSON object (perfect — fast path)
 *  2. JSON wrapped in code fences (``` or ```json)
 *  3. Near-valid JSON with trailing commas or JS comments (repair pass)
 *  4. Multiple JSON objects on separate lines
 *  5. Think + executable action combo (picks the executable)
 *  6. Prose text before/after an otherwise valid JSON object
 *  7. Conversational output (no JSON — classified, not a parse failure)
 *
 * Conservative safety rules:
 *  - Do NOT invent or fabricate actions
 *  - Do NOT guess destructively
 *  - DO recover when extraction is unambiguous
 *  - DO classify failures specifically when recovery is not safe
 */

export type ExtractionMethod =
  | "direct_parse"    // Perfect JSON — no normalization needed
  | "fence_stripped"  // Stripped markdown code fences then parsed
  | "json_repaired"   // Repaired common malformations (trailing commas, comments)
  | "first_extracted" // Extracted first JSON object from mixed prose
  | "best_selected";  // Picked best action from multiple JSON objects

export type NormalizeFailureReason =
  | "conversational"  // Response is prose with no JSON — classified, not malformed
  | "no_json"         // No { found at all
  | "malformed"       // Found { but couldn't parse any valid JSON object
  | "no_action_field" // Valid JSON objects found but none have an "action" field
  | "ambiguous";      // Multiple objects, none match priority list

export interface NormalizeSuccess {
  ok: true;
  action: Record<string, unknown>;
  method: ExtractionMethod;
  warning?: string;
}

export interface NormalizeFailure {
  ok: false;
  reason: NormalizeFailureReason;
  detail: string;
}

export type NormalizeResult = NormalizeSuccess | NormalizeFailure;

// ─── Action priority when multiple JSON objects are found ────────────────────
// done > write_file > run_command > read_file > list_dir > think
// Rationale: prefer terminal/write actions over read/think to avoid loops.
const ACTION_PRIORITY = ["done", "write_file", "run_command", "read_file", "list_dir", "think"] as const;

// ─── Conversational patterns (short, no task intent) ────────────────────────
const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|sup|howdy|greetings)[\s!.,?]*$/i,
  /^(thanks|thank you|thank u|thx|ty)[\s!.,?]*$/i,
  /^(ok|okay|k|cool|got it|sounds good|sure|alright|great|perfect|nice)[\s!.,?]*$/i,
  /^(bye|goodbye|see you|cya|later)[\s!.,?]*$/i,
  /^(yes|no|yep|nope|yeah|nah|yup|nah)[\s!.,?]*$/i,
  /^(what|huh|what\?)[\s!.,?]*$/i,
];

function isConversationalText(text: string): boolean {
  const t = text.trim();
  if (t.length > 100) return false;
  return CONVERSATIONAL_PATTERNS.some((p) => p.test(t));
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();
}

function tryParseObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to repair common JSON malformations before giving up.
 * Only applies safe, reversible transformations — never guesses field values.
 *
 * Handles:
 *  - Trailing commas before } or ]
 *  - JavaScript single-line comments (// ...) inside the JSON structure
 *  - Unicode BOM at start of string
 *  - Trailing junk after the last }
 */
function tryRepairJson(text: string): Record<string, unknown> | null {
  let s = text.trim();

  // Strip BOM
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  // Strip any trailing text after the last } — find the position of the outermost closing brace
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace < 0) return null;
  s = s.slice(0, lastBrace + 1);

  // Remove JavaScript-style single-line comments that appear outside of strings
  // We do this by scanning character by character to avoid munging string contents
  let result = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }
    if (!inString && ch === "/" && s[i + 1] === "/") {
      // Skip to end of line
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    result += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, "$1");

  return tryParseObject(result);
}

function hasAction(obj: Record<string, unknown>): boolean {
  return typeof obj["action"] === "string" && obj["action"] !== "";
}

/**
 * Extract all syntactically complete JSON objects from a string.
 * Scans character-by-character tracking brace depth and string state.
 */
export function extractAllJsonObjects(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") { i++; continue; }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let j = i;

    while (j < text.length) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        if (inString) escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(i, j + 1);
            const parsed = tryParseObject(candidate);
            if (parsed) results.push(parsed);
            i = j + 1;
            break;
          }
        }
      }
      j++;
    }

    // Unclosed brace — give up scanning further
    if (j >= text.length && depth > 0) break;
    // If we didn't advance (e.g. empty brace at same pos), move forward
    if (j >= text.length && depth === 0) break;
  }
  return results;
}

/**
 * Normalize a model response into a single valid action object.
 * Returns either a success with the extracted action, or a typed failure.
 */
export function normalizeModelResponse(text: string): NormalizeResult {
  const raw = text.trim();

  // ── Step 0: Conversational check (no JSON at all, recognizable phrasing) ──
  if (!raw.includes("{")) {
    if (isConversationalText(raw)) {
      return { ok: false, reason: "conversational", detail: raw.slice(0, 200) };
    }
    return {
      ok: false,
      reason: "no_json",
      detail: `No JSON object in response. Preview: ${raw.slice(0, 300)}`,
    };
  }

  // ── Step 1: Direct parse (fast path — ideal model output) ─────────────────
  const direct = tryParseObject(raw);
  if (direct && hasAction(direct)) {
    return { ok: true, action: direct, method: "direct_parse" };
  }

  // ── Step 2: Strip markdown code fences ────────────────────────────────────
  const deFenced = stripCodeFences(raw);
  if (deFenced !== raw) {
    const fenced = tryParseObject(deFenced);
    if (fenced && hasAction(fenced)) {
      return { ok: true, action: fenced, method: "fence_stripped" };
    }
  }

  // ── Step 2.5: JSON repair pass (trailing commas, JS comments, BOM) ────────
  // Try on both the raw text and the de-fenced version
  for (const candidate of [raw, deFenced]) {
    const repaired = tryRepairJson(candidate);
    if (repaired && hasAction(repaired)) {
      return {
        ok: true,
        action: repaired,
        method: "json_repaired",
        warning: "Repaired malformed JSON (trailing commas / comments stripped).",
      };
    }
  }

  // ── Step 3: Extract all JSON objects from mixed text ──────────────────────
  const allObjects = extractAllJsonObjects(raw);

  if (allObjects.length === 0) {
    return {
      ok: false,
      reason: "malformed",
      detail: `Found { but could not parse any valid JSON objects. Preview: ${raw.slice(0, 300)}`,
    };
  }

  const actionObjects = allObjects.filter(hasAction);

  if (actionObjects.length === 0) {
    return {
      ok: false,
      reason: "no_action_field",
      detail: `Parsed ${allObjects.length} JSON object(s) but none have an "action" field. First: ${JSON.stringify(allObjects[0]).slice(0, 200)}`,
    };
  }

  // ── Step 4: Single action object — accept it ───────────────────────────────
  if (actionObjects.length === 1) {
    const isClean = !allObjects.some((o) => !hasAction(o));
    const warning = isClean
      ? undefined
      : `Extracted action object from mixed content (${allObjects.length} total JSON objects).`;
    return { ok: true, action: actionObjects[0], method: "first_extracted", warning };
  }

  // ── Step 5: Multiple action objects — pick best by priority ───────────────
  const actionTypes = actionObjects.map((o) => String(o["action"])).join(", ");

  for (const preferred of ACTION_PRIORITY) {
    const match = actionObjects.find((o) => o["action"] === preferred);
    if (match) {
      return {
        ok: true,
        action: match,
        method: "best_selected",
        warning: `Multiple JSON actions [${actionTypes}] — selected "${preferred}" by priority. Model should output a single action.`,
      };
    }
  }

  // Fallback: take first action object (should not normally reach here)
  return {
    ok: true,
    action: actionObjects[0],
    method: "best_selected",
    warning: `Multiple JSON actions [${actionTypes}] — took first (unknown priority). Check model output format.`,
  };
}

/**
 * Build a corrective retry instruction to push the model back into
 * the expected single-JSON-object format.
 */
export function buildRetryInstruction(
  reason: NormalizeFailureReason,
  responsePreview: string
): string {
  const rule =
    'RULE: Output EXACTLY one JSON object with an "action" field. Nothing else — no prose, no code fences, no multiple objects.';
  const example = '{"action":"think","thought":"Let me re-read the task requirements."}';

  switch (reason) {
    case "conversational":
      return [
        "ERROR: You replied with conversational text instead of a JSON action.",
        rule,
        example,
      ].join("\n");

    case "no_json":
      return [
        "ERROR: Your response contained no JSON object.",
        rule,
        `Your response: ${responsePreview.slice(0, 200)}`,
        example,
      ].join("\n");

    case "malformed":
      return [
        "ERROR: Your response contained malformed JSON. Check brace matching and string escaping.",
        rule,
        `Your response preview: ${responsePreview.slice(0, 200)}`,
        example,
      ].join("\n");

    case "no_action_field":
      return [
        'ERROR: Your JSON object is missing the required "action" field.',
        rule,
        example,
      ].join("\n");

    default:
      return [
        "ERROR: Your response was not a valid JSON action.",
        rule,
        example,
      ].join("\n");
  }
}
