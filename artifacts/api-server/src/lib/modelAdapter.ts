import OpenAI from "openai";
import { logger } from "./logger.js";
import { selectZaiModel, getCapabilitySummary, type ModelSelectionHint } from "./zaiCapabilities.js";

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
}

export interface ModelProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<ModelResponse>;
  chatStream(
    messages: Message[],
    onChunk: (text: string) => void,
    options?: ChatOptions
  ): Promise<ModelResponse>;
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
  // Z.AI returns 429 for BOTH rate-limit AND insufficient balance.
  // Distinguish by message content.
  if (status === 429) {
    if (/balance|credit|quota|resource package|insufficient/i.test(msg)) {
      return new ModelError(
        "Insufficient balance — your Z.AI account has no credits. Top up at https://z.ai/manage-apikey/billing",
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
      "Cannot reach Z.AI — check your network and the ZAI_BASE_URL in your .env.",
      "network_error",
      msg
    );
  }
  if (/base_url|baseurl|invalid url/i.test(msg)) {
    return new ModelError(
      "Invalid base URL — check that ZAI_BASE_URL is a valid HTTPS endpoint (must be https://api.z.ai/api/paas/v4/).",
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

// ─── Official Z.AI constants ─────────────────────────────────────────────────

const ZAI_BASE_URL_DEFAULT = "https://api.z.ai/api/paas/v4/";

// ─── Provider resolution ──────────────────────────────────────────────────────
//
// Priority:
//   1. ZAI (z.ai) — PRIMARY for all local usage when ZAI_API_KEY is set.
//   2. Replit AI Integration — FALLBACK only when ZAI_API_KEY is absent
//      and Replit integration env vars are present.
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderName = "zai" | "replit-openai";

interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  baseURL: string;
  envModelOverride?: string;      // ZAI_MODEL env var (for override/pinning)
  envVisionModelOverride?: string; // ZAI_VISION_MODEL env var
  supportsTemperature: boolean;
  routingReason: string;
}

function resolveProviderConfig(): ProviderConfig {
  // 1. ZAI — primary
  const zaiApiKey = process.env["ZAI_API_KEY"];
  if (zaiApiKey) {
    return {
      name: "zai",
      apiKey: zaiApiKey,
      baseURL: process.env["ZAI_BASE_URL"] || ZAI_BASE_URL_DEFAULT,
      envModelOverride: process.env["ZAI_MODEL"] || undefined,
      envVisionModelOverride: process.env["ZAI_VISION_MODEL"] || undefined,
      supportsTemperature: true,
      routingReason: "ZAI_API_KEY is set — using Z.AI as primary provider",
    };
  }

  // 2. Replit integration — fallback when no ZAI key
  const replitApiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const replitBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  if (replitApiKey && replitBaseURL) {
    return {
      name: "replit-openai",
      apiKey: replitApiKey,
      baseURL: replitBaseURL,
      envModelOverride: process.env["ZAI_MODEL"] || "gpt-5.2",
      supportsTemperature: false,
      routingReason: "No ZAI_API_KEY — falling back to Replit AI integration (gpt-5.2)",
    };
  }

  throw new ModelError(
    [
      "No AI provider configured. To use DevMind locally:",
      "  1. Get an API key at https://z.ai/manage-apikey/apikey-list",
      "  2. Add ZAI_API_KEY=your_key to your .env file at the repo root",
      "  3. Restart the server",
    ].join("\n"),
    "missing_api_key",
    "Neither ZAI_API_KEY nor AI_INTEGRATIONS_OPENAI_API_KEY is set in the environment."
  );
}

// ─── Capability-based model routing ──────────────────────────────────────────

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

function resolveModel(
  messages: Message[],
  options: ChatOptions,
  config: ProviderConfig
): { model: string; routingReason: string } {
  // Explicit override in call options takes highest priority
  if (options.model) {
    return { model: options.model, routingReason: `explicit call-time override: ${options.model}` };
  }

  // For Replit integration — use its fixed model
  if (config.name === "replit-openai") {
    const model = config.envModelOverride || "gpt-5.2";
    return { model, routingReason: `Replit integration: ${model}` };
  }

  // For Z.AI — auto-select via capability registry
  // Detect vision from message content
  const hint: ModelSelectionHint = detectVisionFromMessages(messages)
    ? "vision"
    : (options.taskHint ?? "agentic");

  // Vision override via env takes priority over auto-selection
  if (hint === "vision" && config.envVisionModelOverride) {
    return {
      model: config.envVisionModelOverride,
      routingReason: `vision task + env override: ZAI_VISION_MODEL=${config.envVisionModelOverride}`,
    };
  }

  const selected = selectZaiModel(hint, config.envModelOverride);
  return { model: selected.modelId, routingReason: selected.reason };
}

// ─── OpenAI-compatible provider ───────────────────────────────────────────────

class OpenAICompatibleProvider implements ModelProvider {
  private client: OpenAI;
  private config: ProviderConfig;

  constructor() {
    const config = resolveProviderConfig();
    this.config = config;

    logger.info(
      {
        provider: config.name,
        baseURL: config.baseURL,
        envModelOverride: config.envModelOverride ?? "(none — auto selection active)",
        supportsTemperature: config.supportsTemperature,
        routingReason: config.routingReason,
      },
      `[DevMind] Provider selected: ${config.name}`
    );

    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  private buildParams(
    model: string,
    options: ChatOptions
  ): Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, "messages" | "stream"> {
    const params: Record<string, unknown> = {
      model,
      max_completion_tokens: options.maxTokens ?? 8192,
    };
    if (this.config.supportsTemperature) {
      params["temperature"] = options.temperature ?? 0.1;
    }
    return params as Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, "messages" | "stream">;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ModelResponse> {
    const { model, routingReason } = resolveModel(messages, options, this.config);
    logger.debug({ model, routingReason, provider: this.config.name }, "Model routed (chat)");
    try {
      const response = await this.client.chat.completions.create({
        ...this.buildParams(model, options),
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ModelError(
          "AI provider returned a response with no text content.",
          "unexpected_response",
          `choices[0].message.content = ${JSON.stringify(content)}`
        );
      }
      return {
        content,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
        },
      };
    } catch (err) {
      if (err instanceof ModelError) throw err;
      throw categorizeError(err);
    }
  }

  async chatStream(
    messages: Message[],
    onChunk: (text: string) => void,
    options: ChatOptions = {}
  ): Promise<ModelResponse> {
    const { model, routingReason } = resolveModel(messages, options, this.config);
    logger.debug({ model, routingReason, provider: this.config.name }, "Model routed (stream)");
    try {
      const stream = await this.client.chat.completions.create({
        ...this.buildParams(model, options),
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
        throw new ModelError(
          "AI provider returned an empty response — the model produced no output.",
          "unexpected_response",
          "Stream completed but no content delta was received"
        );
      }
      return { content: fullContent };
    } catch (err) {
      if (err instanceof ModelError) throw err;
      throw categorizeError(err);
    }
  }
}

// ─── Singleton + lifecycle ────────────────────────────────────────────────────

let providerInstance: ModelProvider | null = null;

export function getModelProvider(): ModelProvider {
  if (!providerInstance) {
    providerInstance = new OpenAICompatibleProvider();
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
    logger.info("─".repeat(60));
    logger.info(`[DevMind] AI Provider Diagnostic`);
    logger.info(`  Provider     : ${config.name}`);
    logger.info(`  Base URL     : ${config.baseURL}`);
    logger.info(`  Model auto   : ${config.envModelOverride ? `PINNED → ${config.envModelOverride}` : "enabled (GLM-5.1 for coding, GLM-4.6V for vision)"}`);
    logger.info(`  Temperature  : ${config.supportsTemperature ? "enabled" : "disabled (gpt-5+)"}`);
    logger.info(`  Reason       : ${config.routingReason}`);
    logger.info(getCapabilitySummary()
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")
    );
    logger.info("─".repeat(60));
  } catch (err) {
    const msg = err instanceof ModelError ? err.message : String(err);
    logger.warn(`[DevMind] No AI provider configured:\n${msg}`);
  }
}
