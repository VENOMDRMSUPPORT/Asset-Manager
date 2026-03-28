/**
 * Z.AI Provider Capability Registry
 *
 * Source of truth: https://docs.z.ai/guides/overview/pricing
 *                  https://docs.z.ai/api-reference/introduction
 *
 * Z.AI has TWO distinct API lanes that are separately entitled on the account:
 *
 *   PAAS lane     — /api/paas/v4/chat/completions  (OpenAI-compatible)
 *                   Works for:  glm-4.7-flash, glm-4.5-flash, vision models
 *                   Free-tier models live here.
 *
 *   Anthropic lane — /api/anthropic/v1/messages     (Anthropic-compatible)
 *                   Works for:  glm-5, glm-5.1, glm-4.7 and the broader paid GLM-5 family
 *                   Uses Anthropic SDK request/response schema.
 *
 * Models CANNOT be used on a lane they are not entitled for — the API returns
 * error code 1113 ("Insufficient balance or no resource package"). This is NOT
 * the same as running out of credits; it is a model/lane entitlement mismatch.
 *
 * The registry marks each model's preferred lane and supported lanes so the
 * provider can pick the correct endpoint and fall back intelligently.
 */

// ─── Lane types ───────────────────────────────────────────────────────────────

/** The two Z.AI API endpoint families. */
export type ZaiLane = "paas" | "anthropic";

// ─── Capability types ────────────────────────────────────────────────────────

export type ZaiCapabilityType =
  | "text_coding"
  | "text_general"
  | "vision"
  | "image_gen"
  | "video_gen"
  | "audio_stt"
  | "tools"
  | "structured"
  | "long_context"
  | "agentic"
  | "web_search"
  | "cache";

// ─── Call patterns ───────────────────────────────────────────────────────────

export type ZaiCallPattern =
  | "sync"
  | "streaming"
  | "async_poll";

// ─── Implementation status ───────────────────────────────────────────────────

export type ZaiImplementationStatus =
  | "implemented"
  | "provider_only"
  | "deferred";

// ─── Model spec ──────────────────────────────────────────────────────────────

export interface ZaiModelSpec {
  modelId: string;
  displayName: string;
  description: string;
  capabilities: ZaiCapabilityType[];
  callPatterns: ZaiCallPattern[];
  contextWindow: number;
  maxOutput: number;
  priceInputPer1M: number | null;
  priceOutputPer1M: number | null;
  implementationStatus: ZaiImplementationStatus;
  /** Primary lane to use when calling this model. */
  preferredLane: ZaiLane;
  /** All lanes this model is available on (in preference order). */
  supportedLanes: ZaiLane[];
  notes?: string;
}

// ─── Z.AI Model Registry ─────────────────────────────────────────────────────

export const ZAI_MODEL_REGISTRY: ZaiModelSpec[] = [

  // ═══ Text / Coding models — Anthropic lane ══════════════════════════════════
  // Verified: glm-5 and glm-4.7 work on /api/anthropic/v1/messages
  // glm-5.1 assumed same entitlement as glm-5 (same product family)

  {
    modelId: "glm-5.1",
    displayName: "GLM-5.1",
    description: "Latest Z.AI flagship (2025). Strongest agentic + coding vs GLM-5.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "agentic", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.0,
    priceOutputPer1M: 3.2,
    implementationStatus: "implemented",
    preferredLane: "anthropic",
    supportedLanes: ["anthropic"],
    notes: "Primary VenomGPT model. Auto-selected for coding and agentic tasks. Anthropic lane only.",
  },

  {
    modelId: "glm-5",
    displayName: "GLM-5",
    description: "Z.AI flagship agentic model. 200K context. Verified on Anthropic lane.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "agentic", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.0,
    priceOutputPer1M: 3.2,
    implementationStatus: "implemented",
    preferredLane: "anthropic",
    supportedLanes: ["anthropic"],
    notes: "First fallback when GLM-5.1 is rejected. Anthropic lane only.",
  },

  {
    modelId: "glm-5-code",
    displayName: "GLM-5-Code",
    description: "Code-specialized variant of GLM-5.",
    capabilities: ["text_coding", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 1.2,
    priceOutputPer1M: 5.0,
    implementationStatus: "implemented",
    preferredLane: "anthropic",
    supportedLanes: ["anthropic"],
  },

  {
    modelId: "glm-5-turbo",
    displayName: "GLM-5-Turbo",
    description: "Faster GLM-5 variant.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.2,
    priceOutputPer1M: 4.0,
    implementationStatus: "implemented",
    preferredLane: "anthropic",
    supportedLanes: ["anthropic"],
  },

  {
    modelId: "glm-4.7",
    displayName: "GLM-4.7",
    description: "Balanced mid-tier model. Verified working on Anthropic lane.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 0.6,
    priceOutputPer1M: 2.2,
    implementationStatus: "implemented",
    preferredLane: "anthropic",
    supportedLanes: ["anthropic"],
    notes: "Mid-tier fallback. Anthropic lane only.",
  },

  // ═══ Text / Coding models — PAAS lane (free tier) ══════════════════════════
  // Verified: glm-4.7-flash works on /api/paas/v4/chat/completions

  {
    modelId: "glm-4.7-flash",
    displayName: "GLM-4.7-Flash",
    description: "FREE model. Verified working on PAAS lane. Good for dev/testing.",
    capabilities: ["text_coding", "text_general"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "implemented",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Free tier. PAAS lane. Reliable last-resort fallback for text tasks.",
  },

  {
    modelId: "glm-4.5-flash",
    displayName: "GLM-4.5-Flash",
    description: "FREE model. Older generation, simple tasks.",
    capabilities: ["text_general"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "implemented",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Free tier fallback. PAAS lane.",
  },

  // ═══ Vision models — PAAS lane ══════════════════════════════════════════════

  {
    modelId: "glm-4.6v",
    displayName: "GLM-4.6V",
    description: "SOTA vision model. Text + image input. 128K context.",
    capabilities: ["vision", "text_general", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 0.3,
    priceOutputPer1M: 0.9,
    implementationStatus: "implemented",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Auto-selected when messages contain image_url content. PAAS lane.",
  },

  {
    modelId: "glm-4.6v-flash",
    displayName: "GLM-4.6V-Flash",
    description: "FREE vision model.",
    capabilities: ["vision", "text_general"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "implemented",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Free vision tier. PAAS lane.",
  },

  // ═══ Image generation — not wired ═══════════════════════════════════════════

  {
    modelId: "glm-image",
    displayName: "GLM-Image",
    description: "Text-to-image generation. Uses POST /images/generations.",
    capabilities: ["image_gen"],
    callPatterns: ["sync"],
    contextWindow: 0,
    maxOutput: 0,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "provider_only",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Not wired. Needs dedicated /images/generations endpoint.",
  },

  {
    modelId: "cogview-4",
    displayName: "CogView-4",
    description: "Alternative text-to-image model.",
    capabilities: ["image_gen"],
    callPatterns: ["sync"],
    contextWindow: 0,
    maxOutput: 0,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "provider_only",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Same constraints as GLM-Image.",
  },

  // ═══ Video generation — deferred ════════════════════════════════════════════

  {
    modelId: "cogvideox-3",
    displayName: "CogVideoX-3",
    description: "Text/image to video. Async polling required.",
    capabilities: ["video_gen"],
    callPatterns: ["async_poll"],
    contextWindow: 0,
    maxOutput: 0,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "deferred",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Async polling. Not wired in VenomGPT agent loop.",
  },

  // ═══ Audio — deferred ════════════════════════════════════════════════════════

  {
    modelId: "glm-asr-2512",
    displayName: "GLM-ASR-2512",
    description: "Speech-to-text.",
    capabilities: ["audio_stt"],
    callPatterns: ["sync"],
    contextWindow: 0,
    maxOutput: 0,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "deferred",
    preferredLane: "paas",
    supportedLanes: ["paas"],
    notes: "Audio-specific endpoint. Not wired in VenomGPT.",
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

export function getModelById(modelId: string): ZaiModelSpec | undefined {
  return ZAI_MODEL_REGISTRY.find((m) => m.modelId === modelId);
}

export function getImplementedModels(): ZaiModelSpec[] {
  return ZAI_MODEL_REGISTRY.filter((m) => m.implementationStatus === "implemented");
}

export function getModelsForCapability(cap: ZaiCapabilityType): ZaiModelSpec[] {
  return ZAI_MODEL_REGISTRY.filter((m) => m.capabilities.includes(cap));
}

// ─── Model selection policy ──────────────────────────────────────────────────

export type ModelSelectionHint =
  | "agentic"
  | "coding"
  | "general"
  | "vision"
  | "conversational";

export interface LaneCandidate {
  modelId: string;
  lane: ZaiLane;
  reason: string;
}

/**
 * Returns an ordered list of (model, lane) candidates for the given hint.
 * The provider tries them in order, stopping at the first success.
 *
 * Fallback logic:
 *   agentic/coding  → glm-5.1(anthropic) → glm-5(anthropic) → glm-4.7(anthropic) → glm-4.7-flash(paas)
 *   vision          → glm-4.6v(paas) → glm-4.6v-flash(paas)
 *   conversational  → glm-4.7-flash(paas) → glm-4.5-flash(paas)
 *   general         → glm-4.7-flash(paas) → glm-4.7(anthropic)
 *
 * Env override (ZAI_MODEL) pins to a single model/lane — no chain.
 */
export function getFallbackChain(
  hint: ModelSelectionHint,
  envOverride?: string
): LaneCandidate[] {
  if (envOverride) {
    const spec = getModelById(envOverride);
    const lane: ZaiLane = spec?.preferredLane ?? "paas";
    return [{ modelId: envOverride, lane, reason: `env override: ZAI_MODEL=${envOverride}` }];
  }

  switch (hint) {
    case "agentic":
    case "coding":
      return [
        { modelId: "glm-5.1",      lane: "anthropic", reason: `hint="${hint}" → GLM-5.1 (Anthropic lane, flagship agentic)` },
        { modelId: "glm-5",        lane: "anthropic", reason: `fallback #1 → GLM-5 (Anthropic lane)` },
        { modelId: "glm-4.7",      lane: "anthropic", reason: `fallback #2 → GLM-4.7 (Anthropic lane)` },
        { modelId: "glm-4.7-flash",lane: "paas",      reason: `fallback #3 → GLM-4.7-Flash (PAAS lane, free)` },
      ];

    case "vision":
      return [
        { modelId: "glm-4.6v",       lane: "paas", reason: `hint="vision" → GLM-4.6V (PAAS lane, SOTA multimodal)` },
        { modelId: "glm-4.6v-flash", lane: "paas", reason: `fallback → GLM-4.6V-Flash (PAAS lane, free vision)` },
      ];

    case "conversational":
      return [
        { modelId: "glm-4.7-flash", lane: "paas",      reason: `hint="conversational" → GLM-4.7-Flash (PAAS lane, free, fast)` },
        { modelId: "glm-4.5-flash", lane: "paas",      reason: `fallback → GLM-4.5-Flash (PAAS lane, free)` },
      ];

    case "general":
    default:
      return [
        { modelId: "glm-4.7-flash", lane: "paas",      reason: `hint="${hint}" → GLM-4.7-Flash (PAAS lane, free)` },
        { modelId: "glm-4.7",       lane: "anthropic",  reason: `fallback → GLM-4.7 (Anthropic lane)` },
      ];
  }
}

/**
 * Select the single best model for the given hint (first in fallback chain).
 * Env override (ZAI_MODEL) takes precedence.
 * @deprecated Prefer getFallbackChain() for lane-aware routing with fallback.
 */
export function selectZaiModel(
  hint: ModelSelectionHint,
  envOverride?: string
): { modelId: string; lane: ZaiLane; reason: string } {
  const chain = getFallbackChain(hint, envOverride);
  return chain[0];
}

/**
 * Human-readable capability + lane summary. Used in startup diagnostics.
 */
export function getCapabilitySummary(): string {
  const implemented = getImplementedModels();
  const providerOnly = ZAI_MODEL_REGISTRY.filter((m) => m.implementationStatus === "provider_only");
  const deferred = ZAI_MODEL_REGISTRY.filter((m) => m.implementationStatus === "deferred");

  const paasModels = implemented.filter((m) => m.preferredLane === "paas").map((m) => m.modelId);
  const anthropicModels = implemented.filter((m) => m.preferredLane === "anthropic").map((m) => m.modelId);

  return [
    `Z.AI Capability Registry (${ZAI_MODEL_REGISTRY.length} models, 2 lanes)`,
    `  PAAS lane      (/api/paas/v4/)      : ${paasModels.join(", ")}`,
    `  Anthropic lane (/api/anthropic/v1/) : ${anthropicModels.join(", ")}`,
    `  Provider-only / not wired (${providerOnly.length}): ${providerOnly.map((m) => m.modelId).join(", ")}`,
    `  Deferred (${deferred.length}): ${deferred.map((m) => m.modelId).join(", ")}`,
  ].join("\n");
}
