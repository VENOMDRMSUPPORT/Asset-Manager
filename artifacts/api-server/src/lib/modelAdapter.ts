import OpenAI from "openai";
import { logger } from "./logger.js";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
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

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export type ModelErrorCategory =
  | "missing_api_key"
  | "invalid_api_key"
  | "model_not_found"
  | "base_url_error"
  | "network_error"
  | "rate_limit"
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

function categorizeError(err: unknown): ModelError {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;

  if (status === 401 || /incorrect api key|invalid api key|authentication/i.test(msg)) {
    return new ModelError(
      "Invalid API key — the configured API key was rejected by the provider.",
      "invalid_api_key",
      msg
    );
  }
  if (status === 404 || /model not found|no such model/i.test(msg)) {
    return new ModelError(
      "Model not found — check that the configured model name is valid for this provider.",
      "model_not_found",
      msg
    );
  }
  if (status === 429 || /rate limit|too many requests/i.test(msg)) {
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
      "Cannot reach AI provider — check your network connection and the configured base URL.",
      "network_error",
      msg
    );
  }
  if (/base_url|baseurl|invalid url/i.test(msg)) {
    return new ModelError(
      "Invalid base URL — check that the configured provider base URL is a valid HTTPS endpoint.",
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

// Determine which provider to use:
// 1. Replit AI Integrations (OpenAI proxy) — preferred when running in Replit
// 2. ZAI (z.ai) — for local dev with a user-supplied ZAI_API_KEY
function resolveProviderConfig(): { apiKey: string; baseURL: string; model: string; isReplitIntegration: boolean } {
  const replitApiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  const replitBaseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];

  if (replitApiKey && replitBaseURL) {
    return {
      apiKey: replitApiKey,
      baseURL: replitBaseURL,
      model: process.env["ZAI_MODEL"] || "gpt-5.2",
      isReplitIntegration: true,
    };
  }

  const zaiApiKey = process.env["ZAI_API_KEY"];
  if (zaiApiKey) {
    return {
      apiKey: zaiApiKey,
      baseURL: process.env["ZAI_BASE_URL"] || "https://api.z.ai/v1",
      model: process.env["ZAI_MODEL"] || "z1-32b",
      isReplitIntegration: false,
    };
  }

  throw new ModelError(
    "No AI provider configured. In Replit: add the OpenAI AI integration. Locally: set ZAI_API_KEY in your .env file.",
    "missing_api_key",
    "Neither AI_INTEGRATIONS_OPENAI_API_KEY nor ZAI_API_KEY is set in the environment."
  );
}

class OpenAICompatibleProvider implements ModelProvider {
  private client: OpenAI;
  private defaultModel: string;
  private isReplitIntegration: boolean;

  constructor() {
    const config = resolveProviderConfig();
    this.defaultModel = config.model;
    this.isReplitIntegration = config.isReplitIntegration;

    logger.info(
      { baseURL: config.baseURL, model: this.defaultModel, provider: config.isReplitIntegration ? "replit-openai" : "zai" },
      "Model provider initialized"
    );

    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  private buildParams(model: string, options: ChatOptions): Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, "messages" | "stream"> {
    const params: Record<string, unknown> = {
      model,
      max_completion_tokens: options.maxTokens ?? 8192,
    };
    // gpt-5+ models do not support temperature
    if (!this.isReplitIntegration || model.startsWith("gpt-4") || model.startsWith("gpt-3")) {
      params["temperature"] = options.temperature ?? 0.1;
    }
    return params as Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, "messages" | "stream">;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ModelResponse> {
    const model = options.model || this.defaultModel;
    try {
      const response = await this.client.chat.completions.create({
        ...this.buildParams(model, options),
        messages,
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
    const model = options.model || this.defaultModel;
    try {
      const stream = await this.client.chat.completions.create({
        ...this.buildParams(model, options),
        messages,
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
