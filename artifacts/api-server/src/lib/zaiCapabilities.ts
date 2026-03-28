/**
 * Z.AI Provider Capability Registry
 *
 * Source of truth: https://docs.z.ai/guides/overview/pricing
 *                  https://docs.z.ai/api-reference/introduction
 *                  https://docs.z.ai/guides/llm/glm-5
 *
 * Official base URL: https://api.z.ai/api/paas/v4/
 * (NOT /v1 — that path does not exist on Z.AI)
 *
 * This registry:
 *  - Maps every Z.AI model to its full capability set
 *  - Tracks call patterns (sync / streaming / async_poll)
 *  - Clearly marks what is implemented vs deferred
 *  - Powers automatic model selection per task type
 *  - Includes GLM-5.1 (latest flagship as of 2025)
 */

// ─── Capability types ────────────────────────────────────────────────────────

export type ZaiCapabilityType =
  | "text_coding"   // Code generation, bug fixing, technical reasoning
  | "text_general"  // General-purpose text generation
  | "vision"        // Text + image input
  | "image_gen"     // Text → image (uses /images/generations endpoint)
  | "video_gen"     // Text/image → video (async polling required)
  | "audio_stt"     // Speech-to-text
  | "tools"         // Function calling / tool use
  | "structured"    // JSON / structured output mode
  | "long_context"  // Context window >= 100K tokens
  | "agentic"       // Long-horizon autonomous task execution
  | "web_search"    // Built-in web search (paid per-use tool)
  | "cache";        // KV context caching support

// ─── Call patterns ───────────────────────────────────────────────────────────

export type ZaiCallPattern =
  | "sync"        // Synchronous (non-streaming)
  | "streaming"   // Server-sent events / streaming response
  | "async_poll"; // Submit job, poll for result (video gen etc.)

// ─── Implementation status ───────────────────────────────────────────────────

export type ZaiImplementationStatus =
  | "implemented"   // Fully wired into DevMind agent loop
  | "provider_only" // Z.AI supports it; not yet wired end-to-end in product
  | "deferred";     // Planned, not started

// ─── Model spec ──────────────────────────────────────────────────────────────

export interface ZaiModelSpec {
  modelId: string;
  displayName: string;
  description: string;
  capabilities: ZaiCapabilityType[];
  callPatterns: ZaiCallPattern[];
  contextWindow: number;           // tokens
  maxOutput: number;               // tokens
  priceInputPer1M: number | null;  // USD, null = free
  priceOutputPer1M: number | null; // USD, null = free
  implementationStatus: ZaiImplementationStatus;
  notes?: string;
}

// ─── Z.AI Model Registry ────────────────────────────────────────────────────

export const ZAI_MODEL_REGISTRY: ZaiModelSpec[] = [

  // ═══ Text / Coding models ══════════════════════════════════════════════════

  {
    modelId: "glm-5.1",
    displayName: "GLM-5.1",
    description: "Latest Z.AI flagship (2025). Stronger agentic + coding vs GLM-5.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "agentic", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.0,
    priceOutputPer1M: 3.2,
    implementationStatus: "implemented",
    notes: "Primary DevMind model. Auto-selected for coding and agentic tasks.",
  },

  {
    modelId: "glm-5",
    displayName: "GLM-5",
    description: "Z.AI flagship agentic model. Coding on par with Claude Opus 4.5. 200K context.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "agentic", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.0,
    priceOutputPer1M: 3.2,
    implementationStatus: "implemented",
    notes: "Fallback when GLM-5.1 is unavailable or rejected.",
  },

  {
    modelId: "glm-5-code",
    displayName: "GLM-5-Code",
    description: "Code-specialized variant of GLM-5. Higher per-token cost.",
    capabilities: ["text_coding", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 1.2,
    priceOutputPer1M: 5.0,
    implementationStatus: "implemented",
    notes: "Use when code-only specialization is preferred over general reasoning.",
  },

  {
    modelId: "glm-5-turbo",
    displayName: "GLM-5-Turbo",
    description: "Faster GLM-5 variant. Lower latency.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "long_context", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 200_000,
    maxOutput: 128_000,
    priceInputPer1M: 1.2,
    priceOutputPer1M: 4.0,
    implementationStatus: "implemented",
  },

  {
    modelId: "glm-4.7",
    displayName: "GLM-4.7",
    description: "Balanced model. Lower cost than GLM-5 family.",
    capabilities: ["text_coding", "text_general", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 0.6,
    priceOutputPer1M: 2.2,
    implementationStatus: "implemented",
  },

  {
    modelId: "glm-4.7-flash",
    displayName: "GLM-4.7-Flash",
    description: "FREE model. Good for development/testing and low-stakes tasks.",
    capabilities: ["text_coding", "text_general"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "implemented",
    notes: "Free tier. Recommended for local dev when cost matters.",
  },

  {
    modelId: "glm-4.5-flash",
    displayName: "GLM-4.5-Flash",
    description: "FREE model. Older generation, suitable for simple tasks.",
    capabilities: ["text_general"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "implemented",
    notes: "Free tier fallback.",
  },

  // ═══ Vision models ═════════════════════════════════════════════════════════

  {
    modelId: "glm-4.6v",
    displayName: "GLM-4.6V",
    description: "SOTA vision model. Accepts text + image input. 128K context.",
    capabilities: ["vision", "text_general", "tools", "structured", "cache"],
    callPatterns: ["sync", "streaming"],
    contextWindow: 128_000,
    maxOutput: 32_000,
    priceInputPer1M: 0.3,
    priceOutputPer1M: 0.9,
    implementationStatus: "implemented",
    notes: "Auto-selected when messages contain image_url content.",
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
    notes: "Free vision tier.",
  },

  // ═══ Image generation models ════════════════════════════════════════════════
  // NOTE: These use POST /images/generations — a separate endpoint from
  // /chat/completions. Not wired into the DevMind agent loop.

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
    notes: "Not wired. Needs dedicated /images/generations tool, not chat completions.",
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
    notes: "Same constraints as GLM-Image.",
  },

  // ═══ Video generation models ═════════════════════════════════════════════════
  // NOTE: Require async polling — not wired in DevMind.

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
    notes: "Async polling. Not wired in DevMind agent loop.",
  },

  // ═══ Audio models ═════════════════════════════════════════════════════════

  {
    modelId: "glm-asr-2512",
    displayName: "GLM-ASR-2512",
    description: "Speech-to-text (audio recognition).",
    capabilities: ["audio_stt"],
    callPatterns: ["sync"],
    contextWindow: 0,
    maxOutput: 0,
    priceInputPer1M: null,
    priceOutputPer1M: null,
    implementationStatus: "deferred",
    notes: "Audio-specific endpoint. Not wired in DevMind.",
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
  | "agentic"       // Complex multi-step autonomous tasks (DevMind default)
  | "coding"        // Code creation, editing, debugging
  | "general"       // General text, light reasoning
  | "vision"        // Message contains image content
  | "conversational"; // Simple conversational prompt (cheap model ok)

/**
 * Select the best Z.AI model for the given task hint.
 *
 * Priority:
 *   GLM-5.1 for coding/agentic (best current model)
 *   GLM-5   fallback for coding/agentic
 *   GLM-4.6V for vision
 *   GLM-4.7-Flash for conversational/general (free)
 *
 * Env override (ZAI_MODEL) takes precedence for debugging/pinning.
 */
export function selectZaiModel(
  hint: ModelSelectionHint,
  envOverride?: string
): { modelId: string; reason: string } {
  if (envOverride) {
    return {
      modelId: envOverride,
      reason: `env override: ZAI_MODEL=${envOverride} (clears automatic selection)`,
    };
  }

  switch (hint) {
    case "agentic":
    case "coding":
      return {
        modelId: "glm-5.1",
        reason: `hint="${hint}" → GLM-5.1 (latest flagship agentic, SOTA coding, 200K ctx)`,
      };

    case "vision":
      return {
        modelId: "glm-4.6v",
        reason: `hint="vision" → GLM-4.6V (SOTA multimodal, image+text input)`,
      };

    case "conversational":
    case "general":
      return {
        modelId: "glm-4.7-flash",
        reason: `hint="${hint}" → GLM-4.7-Flash (free, fast, no heavy reasoning needed)`,
      };

    default:
      return {
        modelId: "glm-5.1",
        reason: `hint="${hint}" (unknown) → defaulting to GLM-5.1`,
      };
  }
}

/**
 * Log a human-readable capability summary. Call at startup for diagnostics.
 */
export function getCapabilitySummary(): string {
  const implemented = getImplementedModels();
  const providerOnly = ZAI_MODEL_REGISTRY.filter((m) => m.implementationStatus === "provider_only");
  const deferred = ZAI_MODEL_REGISTRY.filter((m) => m.implementationStatus === "deferred");

  return [
    `Z.AI Capability Registry (${ZAI_MODEL_REGISTRY.length} models)`,
    `  Implemented (${implemented.length}): ${implemented.map((m) => m.modelId).join(", ")}`,
    `  Provider-only / not wired (${providerOnly.length}): ${providerOnly.map((m) => m.modelId).join(", ")}`,
    `  Deferred (${deferred.length}): ${deferred.map((m) => m.modelId).join(", ")}`,
  ].join("\n");
}
