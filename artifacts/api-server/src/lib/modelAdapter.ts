import OpenAI from "openai";
import { logger } from "./logger.js";
import {
  getFallbackChain,
  getCapabilitySummary,
  getModelById,
  type ModelSelectionHint,
  type ZaiLane,
  type LaneCandidate,
} from "./zaiCapabilities.js";

// ─── Public message types ─────────────────────────────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant";
  content: string | MessageContentPart[];
}

export interface MessageContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ModelResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
  /** Which model was actually used (may differ from requested if fallback engaged). */
  modelUsed?: string;
  /** Which lane was used. */
  laneUsed?: ZaiLane;
}

export interface ModelProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<ModelResponse>;
  chatStream(
    messages: Message[],
    onChunk: (text: string) => void,
    options?: ChatOptions
  ): Promise<ModelResponse>;
  /**
   * Returns true if this provider can handle vision (image_url) messages.
   * Z.AI always has glm-4.6v on the PAAS lane.
   * Replit OpenAI integration does not expose a vision model.
   */
  isVisionCapable(): boolean;
}

export type { ModelSelectionHint };

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  taskHint?: ModelSelectionHint;
}

// ─── Error categories ────────────────────────────────────────────────────────

export type ModelErrorCategory =
  | "missing_api_key"
  | "invalid_api_key"
  | "model_not_found"
  | "base_url_error"
  | "network_error"
  | "rate_limit"
  | "insufficient_balance"
  | "entitlement_error"    // Z.AI error 1113: model not available on this lane/package
  | "context_length"
  | "unexpected_response"
  | "unknown";

export class ModelError extends Error {
  category: ModelErrorCategory;
  technical: string;

  constructor(message: string, category: ModelErrorCategory, technical: string) {
    super(message);
    this.name = "ModelError";
    this.category = category;
    this.technical = technical;
  }
}

/** Returns true if the error is a transient access error worth retrying on a different model/lane. */
export function isEntitlementError(err: unknown): boolean {
  if (err instanceof ModelError) {
    return err.category === "entitlement_error" || err.category === "insufficient_balance";
  }
  return false;
}

// ─── Error categorization ────────────────────────────────────────────────────

function categorizeError(err: unknown): ModelError {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;

  if (status === 401 || /incorrect api key|invalid api key|authentication/i.test(msg)) {
    return new ModelError(
      "Invalid API key — the configured ZAI_API_KEY was rejected. Check https://z.ai/manage-apikey/apikey-list",
      "invalid_api_key",
      msg
    );
  }

  if (status === 404 || /model not found|no such model/i.test(msg)) {
    return new ModelError(
      "Model not found — the requested model does not exist on Z.AI. Check ZAI_MODEL in .env or the model auto-selection policy.",
      "model_not_found",
      msg
    );
  }

  // Z.AI error code 1113 = the model is not entitled on this API lane/package.
  // This is NOT the same as running out of credits. The account has access to the API
  // but not to this specific model on this specific lane.
  if (/\b1113\b/.test(msg) || /no resource package/i.test(msg)) {
    return new ModelError(
      "API access unavailable for this model/endpoint combination — your Z.AI account may not include the resource package for this model on this lane. Trying a fallback model.",
      "entitlement_error",
      msg
    );
  }

  // Z.AI returns 429 for both rate-limit AND balance exhaustion.
  if (status === 429) {
    if (/balance|credit|quota|resource package|insufficient/i.test(msg)) {
      return new ModelError(
        "Insufficient Z.AI account balance — no credits remaining. Top up at https://z.ai/manage-apikey/billing. Trying a free fallback model.",
        "insufficient_balance",
        msg
      );
    }
    return new ModelError(
      "Rate limit reached — too many requests. Wait a moment and try again.",
      "rate_limit",
      msg
    );
  }

  if (/rate limit|too many requests/i.test(msg)) {
    return new ModelError(
      "Rate limit reached — too many requests. Wait a moment and try again.",
      "rate_limit",
      msg
    );
  }

  if (/context.*length|maximum.*token|token.*limit/i.test(msg)) {
    return new ModelError(
      "Context length exceeded — the conversation is too long for this model.",
      "context_length",
      msg
    );
  }

  if (/econnrefused|network|timeout|fetch failed|socket/i.test(msg)) {
    return new ModelError(
      "Cannot reach Z.AI — check your network connection.",
      "network_error",
      msg
    );
  }

  if (/base_url|baseurl|invalid url/i.test(msg)) {
    return new ModelError(
      "Invalid base URL — check ZAI_BASE_URL in .env (must be https://api.z.ai/api/paas/v4/).",
      "base_url_error",
      msg
    );
  }

  return new ModelError(
    `AI provider returned an unexpected error: ${msg}`,
    "unknown",
    msg
  );
}

// ─── Z.AI lane constants ──────────────────────────────────────────────────────

const ZAI_PAAS_BASE_URL_DEFAULT = "https://api.z.ai/api/paas/v4/";
const ZAI_ANTHROPIC_BASE_URL_DEFAULT = "https://api.z.ai/api/anthropic/v1";
const ANTHROPIC_VERSION = "2023-06-01";

function deriveAnthropicBaseURL(paasBaseURL: string): string {
  try {
    const url = new URL(paasBaseURL);
    return `${url.protocol}//${url.host}/api/anthropic/v1`;
  } catch {
    return ZAI_ANTHROPIC_BASE_URL_DEFAULT;
  }
}

// ─── Provider configuration ──────────────────────────────────────────────────

export type ProviderName = "zai" | "replit-openai";

interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  paasBaseURL: string;
  anthropicBaseURL: string;
  envModelOverride?: string;
  envVisionModelOverride?: string;
  supportsTemperature: boolean;
  routingReason: string;
}

function resolveProviderConfig(): ProviderConfig {
  const zaiApiKey = process.env["ZAI_API_KEY"];
  if (zaiApiKey) {
    const paasBaseURL = process.env["ZAI_BASE_URL"] || ZAI_PAAS_BASE_URL_DEFAULT;
    return {
      name: "zai",
      apiKey: zaiApiKey,
      paasBaseURL,
      anthropicBaseURL: deriveAnthropicBaseURL(paasBaseURL),
      envModelOverride: process.env["ZAI_MODEL"] || undefined,
      envVisionModelOverride: process.env["ZAI_VISION_MODEL"] || undefined,
      supportsTemperature: true,
      routingReason: "ZAI_API_KEY is set — using Z.AI (PAAS + Anthropic lanes)",
    };
  }

  const replitApiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const replitBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  if (replitApiKey && replitBaseURL) {
    return {
      name: "replit-openai",
      apiKey: replitApiKey,
      paasBaseURL: replitBaseURL,
      anthropicBaseURL: "",
      envModelOverride: process.env["ZAI_MODEL"] || "gpt-5.2",
      supportsTemperature: false,
      routingReason: "No ZAI_API_KEY — falling back to Replit AI integration (gpt-5.2)",
    };
  }

  throw new ModelError(
    [
      "No AI provider configured. To use VenomGPT locally:",
      "  1. Get an API key at https://z.ai/manage-apikey/apikey-list",
      "  2. Add ZAI_API_KEY=your_key to your .env file at the repo root",
      "  3. Restart the server",
    ].join("\n"),
    "missing_api_key",
    "Neither ZAI_API_KEY nor AI_INTEGRATIONS_OPENAI_API_KEY is set in the environment."
  );
}

// ─── Vision detection ─────────────────────────────────────────────────────────

function detectVisionFromMessages(messages: Message[]): boolean {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url") return true;
      }
    }
  }
  return false;
}

// ─── Anthropic lane — fetch-based client ──────────────────────────────────────
// The Anthropic lane uses a different request/response schema from OpenAI.
// We call it with fetch directly to avoid adding the Anthropic SDK as a dependency.

interface AnthropicRequestMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: "text"; text: string }>;
}

function messagesToAnthropic(messages: Message[]): {
  system: string | undefined;
  messages: AnthropicRequestMessage[];
} {
  const systemMsg = messages.find((m) => m.role === "system");
  const system = systemMsg
    ? typeof systemMsg.content === "string"
      ? systemMsg.content
      : systemMsg.content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("")
    : undefined;

  const nonSystem = messages.filter((m) => m.role !== "system");
  const converted: AnthropicRequestMessage[] = nonSystem.map((m) => ({
    role: m.role as "user" | "assistant",
    // INTENTIONAL: image_url parts are stripped here. Vision tasks are routed to
    // the PAAS lane (glm-4.6v) exclusively — the Anthropic lane models do not
    // support vision. The visual analysis is converted to plain text before being
    // forwarded to any Anthropic-lane call. If Anthropic-lane vision support is
    // added in future, this filter must be updated to emit Anthropic image blocks.
    content: typeof m.content === "string"
      ? m.content
      : m.content
          .filter((p) => p.type === "text")
          .map((p) => ({ type: "text" as const, text: p.text ?? "" })),
  }));

  return { system, messages: converted };
}

async function callAnthropicLane(
  apiKey: string,
  anthropicBaseURL: string,
  model: string,
  messages: Message[],
  options: ChatOptions
): Promise<ModelResponse> {
  const { system, messages: anthropicMessages } = messagesToAnthropic(messages);

  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 8192,
    messages: anthropicMessages,
  };
  if (system) body["system"] = system;
  if (options.temperature !== undefined) body["temperature"] = options.temperature;

  const url = `${anthropicBaseURL.replace(/\/$/, "")}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw categorizeError(err);
  }

  const responseText = await response.text();

  if (!response.ok) {
    // Parse Z.AI error format: {"error":{"code":"1113","message":"..."}}
    let errMsg = responseText;
    try {
      const errData = JSON.parse(responseText) as { error?: { code?: string; message?: string } };
      if (errData.error?.message) {
        errMsg = `code=${errData.error.code ?? response.status}: ${errData.error.message}`;
      }
    } catch { /* use raw text */ }
    throw categorizeError(new Error(`HTTP ${response.status} from Z.AI Anthropic lane: ${errMsg}`));
  }

  let data: { content: Array<{ type: string; text: string }>; usage?: { input_tokens: number; output_tokens: number } };
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new ModelError("Anthropic lane returned non-JSON response.", "unexpected_response", responseText.slice(0, 200));
  }

  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (!text) {
    throw new ModelError("Anthropic lane returned a response with no text content.", "unexpected_response", JSON.stringify(data).slice(0, 200));
  }

  return {
    content: text,
    usage: data.usage
      ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
      : undefined,
    modelUsed: model,
    laneUsed: "anthropic",
  };
}

async function callAnthropicLaneStream(
  apiKey: string,
  anthropicBaseURL: string,
  model: string,
  messages: Message[],
  onChunk: (text: string) => void,
  options: ChatOptions
): Promise<ModelResponse> {
  const { system, messages: anthropicMessages } = messagesToAnthropic(messages);

  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 8192,
    messages: anthropicMessages,
    stream: true,
  };
  if (system) body["system"] = system;
  if (options.temperature !== undefined) body["temperature"] = options.temperature;

  const url = `${anthropicBaseURL.replace(/\/$/, "")}/messages`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw categorizeError(err);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let errMsg = errorText;
    try {
      const errData = JSON.parse(errorText) as { error?: { code?: string; message?: string } };
      if (errData.error?.message) {
        errMsg = `code=${errData.error.code ?? response.status}: ${errData.error.message}`;
      }
    } catch { /* use raw text */ }
    throw categorizeError(new Error(`HTTP ${response.status} from Z.AI Anthropic lane: ${errMsg}`));
  }

  // Parse SSE stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        try {
          const event = JSON.parse(dataStr) as {
            type: string;
            delta?: { type: string; text?: string };
          };
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            fullContent += event.delta.text;
            onChunk(event.delta.text);
          }
        } catch { /* skip malformed SSE event */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullContent) {
    throw new ModelError(
      "Anthropic lane stream completed but produced no content.",
      "unexpected_response",
      "Empty stream from Anthropic lane"
    );
  }

  return { content: fullContent, modelUsed: model, laneUsed: "anthropic" };
}

// ─── PAAS lane helpers ────────────────────────────────────────────────────────

function buildPaasParams(
  model: string,
  options: ChatOptions,
  supportsTemperature: boolean
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model,
    max_completion_tokens: options.maxTokens ?? 8192,
  };
  if (supportsTemperature) {
    params["temperature"] = options.temperature ?? 0.1;
  }
  return params;
}

// ─── Lane-aware fallback logic ────────────────────────────────────────────────

type ProviderCallFn = (candidate: LaneCandidate) => Promise<ModelResponse>;

async function callWithFallback(
  chain: LaneCandidate[],
  callFn: ProviderCallFn,
  logContext: string
): Promise<ModelResponse> {
  let lastErr: unknown;

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];
    const isRetry = i > 0;

    if (isRetry) {
      logger.warn(
        { modelId: candidate.modelId, lane: candidate.lane, attempt: i + 1 },
        `[VenomGPT] ${logContext}: trying fallback #${i} — ${candidate.modelId} (${candidate.lane} lane)`
      );
    } else {
      logger.debug(
        { modelId: candidate.modelId, lane: candidate.lane },
        `[VenomGPT] ${logContext}: ${candidate.reason}`
      );
    }

    try {
      const result = await callFn(candidate);
      if (isRetry) {
        logger.info(
          { modelId: candidate.modelId, lane: candidate.lane },
          `[VenomGPT] ${logContext}: fallback succeeded with ${candidate.modelId} (${candidate.lane} lane)`
        );
      }
      return result;
    } catch (err) {
      const categorized = err instanceof ModelError ? err : categorizeError(err);
      lastErr = categorized;

      const retriable = isEntitlementError(categorized);
      logger.warn(
        { modelId: candidate.modelId, lane: candidate.lane, category: categorized.category, retriable },
        `[VenomGPT] ${logContext}: ${candidate.modelId} failed [${categorized.category}]`
      );

      if (!retriable) {
        // Hard errors (invalid key, network, etc.) don't benefit from retrying another model
        throw categorized;
      }

      // Entitlement/balance errors: try next candidate if available
      if (i === chain.length - 1) {
        throw new ModelError(
          `All Z.AI models in the fallback chain are unavailable. Last error: ${categorized.message}`,
          categorized.category,
          categorized.technical
        );
      }
      // Continue to next candidate
    }
  }

  // Should never reach here
  throw lastErr ?? new ModelError("No fallback candidates available.", "unknown", "empty chain");
}

// ─── Main provider implementation ─────────────────────────────────────────────

class ZaiProvider implements ModelProvider {
  private paasClient: OpenAI;
  private config: ProviderConfig;

  constructor() {
    const config = resolveProviderConfig();
    this.config = config;
    this.paasClient = new OpenAI({ apiKey: config.apiKey, baseURL: config.paasBaseURL });
  }

  private resolveChain(messages: Message[], options: ChatOptions): LaneCandidate[] {
    // Explicit call-time model override → single candidate
    if (options.model) {
      const spec = getModelById(options.model);
      return [{ modelId: options.model, lane: spec?.preferredLane ?? "paas", reason: `call-time override: ${options.model}` }];
    }

    // Replit integration → fixed model on PAAS-compat lane
    if (this.config.name === "replit-openai") {
      const model = this.config.envModelOverride || "gpt-5.2";
      return [{ modelId: model, lane: "paas", reason: `Replit integration: ${model}` }];
    }

    // Z.AI — build lane-aware fallback chain
    const hint: ModelSelectionHint = detectVisionFromMessages(messages)
      ? "vision"
      : (options.taskHint ?? "agentic");

    if (hint === "vision" && this.config.envVisionModelOverride) {
      return [{ modelId: this.config.envVisionModelOverride, lane: "paas", reason: `env vision override: ${this.config.envVisionModelOverride}` }];
    }

    return getFallbackChain(hint, this.config.envModelOverride);
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ModelResponse> {
    const chain = this.resolveChain(messages, options);
    const config = this.config;
    const paasClient = this.paasClient;

    return callWithFallback(chain, async (candidate) => {
      if (candidate.lane === "anthropic" && config.name === "zai") {
        return callAnthropicLane(config.apiKey, config.anthropicBaseURL, candidate.modelId, messages, options);
      }

      // PAAS lane (OpenAI-compat)
      try {
        const params = buildPaasParams(candidate.modelId, options, config.supportsTemperature);
        const response = await paasClient.chat.completions.create({
          ...params,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

        const content = response.choices[0]?.message?.content;
        if (typeof content !== "string") {
          throw new ModelError("PAAS lane returned no text content.", "unexpected_response", JSON.stringify(content));
        }
        return {
          content,
          usage: { promptTokens: response.usage?.prompt_tokens || 0, completionTokens: response.usage?.completion_tokens || 0 },
          modelUsed: candidate.modelId,
          laneUsed: "paas",
        };
      } catch (err) {
        if (err instanceof ModelError) throw err;
        throw categorizeError(err);
      }
    }, "chat");
  }

  isVisionCapable(): boolean {
    // Replit AI integration does not expose a vision-capable model.
    // Z.AI always has glm-4.6v / glm-4.6v-flash on the PAAS lane.
    return this.config.name === "zai";
  }

  async chatStream(
    messages: Message[],
    onChunk: (text: string) => void,
    options: ChatOptions = {}
  ): Promise<ModelResponse> {
    const chain = this.resolveChain(messages, options);
    const config = this.config;
    const paasClient = this.paasClient;

    return callWithFallback(chain, async (candidate) => {
      if (candidate.lane === "anthropic" && config.name === "zai") {
        return callAnthropicLaneStream(config.apiKey, config.anthropicBaseURL, candidate.modelId, messages, onChunk, options);
      }

      // PAAS lane streaming
      try {
        const params = buildPaasParams(candidate.modelId, options, config.supportsTemperature);
        const stream = await paasClient.chat.completions.create({
          ...params,
          messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          stream: true,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

        let fullContent = "";
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            fullContent += text;
            onChunk(text);
          }
        }

        if (!fullContent) {
          throw new ModelError("PAAS lane stream completed with no content.", "unexpected_response", "Empty stream");
        }
        return { content: fullContent, modelUsed: candidate.modelId, laneUsed: "paas" };
      } catch (err) {
        if (err instanceof ModelError) throw err;
        throw categorizeError(err);
      }
    }, "chatStream");
  }
}

// ─── Singleton + lifecycle ────────────────────────────────────────────────────

let providerInstance: ModelProvider | null = null;

export function getModelProvider(): ModelProvider {
  if (!providerInstance) {
    providerInstance = new ZaiProvider();
  }
  return providerInstance;
}

export function resetModelProvider(): void {
  providerInstance = null;
}

// ─── Startup diagnostic ───────────────────────────────────────────────────────

export function logProviderDiagnostic(): void {
  try {
    const config = resolveProviderConfig();
    const isZai = config.name === "zai";

    logger.info("─".repeat(60));
    logger.info("[VenomGPT] AI Provider Diagnostic");
    logger.info(`  Provider         : ${config.name}`);
    logger.info(`  PAAS lane URL    : ${config.paasBaseURL}`);
    if (isZai) {
      logger.info(`  Anthropic lane   : ${config.anthropicBaseURL}`);
      logger.info(`  Default routing  : agentic/coding → GLM-5.1 (Anthropic lane) with lane+model fallback`);
    }
    logger.info(`  Model pinned     : ${config.envModelOverride ?? "(none — auto selection active)"}`);
    logger.info(`  Temperature      : ${config.supportsTemperature ? "enabled" : "disabled (gpt-5+)"}`);
    logger.info(`  Reason           : ${config.routingReason}`);
    logger.info(
      getCapabilitySummary()
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")
    );
    logger.info("─".repeat(60));
  } catch (err) {
    const msg = err instanceof ModelError ? err.message : String(err);
    logger.warn(`[VenomGPT] No AI provider configured:\n${msg}`);
  }
}
