import OpenAI from "openai";
import { logger } from "./logger.js";

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

export type TaskHint = "coding" | "vision" | "general";

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  taskHint?: TaskHint;
}

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

// ─── Z.AI Official Model Names (from docs.z.ai/guides/overview/pricing) ──────
// Base URL: https://api.z.ai/api/paas/v4/
// OpenAI SDK compatible at that base URL.
//
// Text / Coding models:
//   glm-5           – flagship agentic/coding (200K ctx, SOTA coding vs Claude Opus 4.5) — DEFAULT
//   glm-5-turbo     – faster variant of GLM-5
//   glm-5-code      – code-specialist
//   glm-4.7         – balanced, lower cost
//   glm-4.7-flash   – FREE, good for testing
//   glm-4.5-flash   – FREE
//
// Vision models (text + image input):
//   glm-4.6v        – multimodal, 128K ctx, SOTA vision — DEFAULT VISION
//   glm-4.6v-flash  – FREE vision
//
// Image generation (NOT wired in this app — POST /images/generations):
//   glm-image, cogview-4
// ─────────────────────────────────────────────────────────────────────────────

const ZAI_BASE_URL_DEFAULT = "https://api.z.ai/api/paas/v4/";
const ZAI_MODEL_CODING_DEFAULT = "glm-5";
const ZAI_MODEL_VISION_DEFAULT = "glm-4.6v";

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
      "Model not found — the model name does not exist on this provider. Check ZAI_MODEL in your .env.",
      "model_not_found",
      msg
    );
  }
  // ZAI returns 429 for BOTH rate-limit AND insufficient balance.
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
      "Cannot reach AI provider — check your network connection and the ZAI_BASE_URL in your .env.",
      "network_error",
      msg
    );
  }
  if (/base_url|baseurl|invalid url/i.test(msg)) {
    return new ModelError(
      "Invalid base URL — check that ZAI_BASE_URL is a valid HTTPS endpoint.",
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

// ─── Provider resolution ──────────────────────────────────────────────────────
// Priority:
//   1. ZAI (z.ai) — primary for ALL local usage. Used whenever ZAI_API_KEY is set.
//   2. Replit AI Integration — only when ZAI_API_KEY is absent AND Replit integration
//      vars are present (i.e., running inside Replit without a ZAI key configured).
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderName = "zai" | "replit-openai";

interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  baseURL: string;
  defaultCodingModel: string;
  defaultVisionModel: string;
  supportsTemperature: boolean;
  routingReason: string;
}

function resolveProviderConfig(): ProviderConfig {
  // 1. ZAI — primary
  const zaiApiKey = process.env["ZAI_API_KEY"];
  if (zaiApiKey) {
    const baseURL = process.env["ZAI_BASE_URL"] || ZAI_BASE_URL_DEFAULT;
    const codingModel = process.env["ZAI_MODEL"] || ZAI_MODEL_CODING_DEFAULT;
    const visionModel = process.env["ZAI_VISION_MODEL"] || ZAI_MODEL_VISION_DEFAULT;
    return {
      name: "zai",
      apiKey: zaiApiKey,
      baseURL,
      defaultCodingModel: codingModel,
      defaultVisionModel: visionModel,
      supportsTemperature: true,
      routingReason: "ZAI_API_KEY is set — using Z.AI as primary provider",
    };
  }

  // 2. Replit integration — fallback when in Replit without ZAI key
  const replitApiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const replitBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  if (replitApiKey && replitBaseURL) {
    const model = process.env["ZAI_MODEL"] || "gpt-5.2";
    return {
      name: "replit-openai",
      apiKey: replitApiKey,
      baseURL: replitBaseURL,
      defaultCodingModel: model,
      defaultVisionModel: model,
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
// Automatically selects the right model for a given task without user input.
// Text/coding → default coding model (glm-5)
// Vision      → vision-capable model (glm-4.6v) when image content detected
// Image gen   → NOT supported yet (documented below)
// ─────────────────────────────────────────────────────────────────────────────

function detectTaskHint(messages: Message[]): TaskHint {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url") return "vision";
      }
    }
  }
  return "coding";
}

function routeModel(
  messages: Message[],
  options: ChatOptions,
  config: ProviderConfig
): { model: string; routingReason: string } {
  if (options.model) {
    return { model: options.model, routingReason: `explicit override: ${options.model}` };
  }

  const hint = options.taskHint ?? detectTaskHint(messages);

  if (hint === "vision") {
    return {
      model: config.defaultVisionModel,
      routingReason: `vision task detected → ${config.defaultVisionModel}`,
    };
  }

  return {
    model: config.defaultCodingModel,
    routingReason: `coding/text task → ${config.defaultCodingModel}`,
  };
}

// ─── NOTE: Image Generation ───────────────────────────────────────────────────
// Z.AI supports image generation via GLM-Image and CogView-4 at POST /images/generations.
// This is NOT wired into the current agent loop. The agent only uses chat completions.
// To add image generation: create a separate tool in fileTools.ts that calls
// /images/generations and saves the result to a file in the workspace.
// ─────────────────────────────────────────────────────────────────────────────

class OpenAICompatibleProvider implements ModelProvider {
  private client: OpenAI;
  private config: ProviderConfig;

  constructor() {
    const config = resolveProviderConfig();
    this.config = config;

    // Startup diagnostic — log provider selection at INFO level
    logger.info(
      {
        provider: config.name,
        baseURL: config.baseURL,
        codingModel: config.defaultCodingModel,
        visionModel: config.defaultVisionModel,
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
    const { model, routingReason } = routeModel(messages, options, this.config);
    logger.debug({ model, routingReason, provider: this.config.name }, "Model routed for chat");
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
    const { model, routingReason } = routeModel(messages, options, this.config);
    logger.debug({ model, routingReason, provider: this.config.name }, "Model routed for stream");
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

// ─── Startup provider diagnostic (call once at server boot) ──────────────────
// Logs exactly which provider is chosen, which base URL is used, and which
// model will be routed for coding vs vision tasks.
// Does NOT make a network request — purely config inspection.
// ─────────────────────────────────────────────────────────────────────────────
export function logProviderDiagnostic(): void {
  try {
    const config = resolveProviderConfig();
    logger.info("─".repeat(60));
    logger.info(`[DevMind] AI Provider Diagnostic`);
    logger.info(`  Provider     : ${config.name}`);
    logger.info(`  Base URL     : ${config.baseURL}`);
    logger.info(`  Coding model : ${config.defaultCodingModel}`);
    logger.info(`  Vision model : ${config.defaultVisionModel}`);
    logger.info(`  Temperature  : ${config.supportsTemperature ? "enabled" : "disabled (gpt-5+)"}`);
    logger.info(`  Reason       : ${config.routingReason}`);
    logger.info("─".repeat(60));
  } catch (err) {
    const msg = err instanceof ModelError ? err.message : String(err);
    logger.warn(`[DevMind] No AI provider configured:\n${msg}`);
  }
}
