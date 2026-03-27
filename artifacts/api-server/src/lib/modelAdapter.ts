import OpenAI from "openai";

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

class ZaiProvider implements ModelProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor() {
    const apiKey = process.env["ZAI_API_KEY"];
    const baseURL = process.env["ZAI_BASE_URL"] || "https://api.z.ai/v1";
    this.defaultModel = process.env["ZAI_MODEL"] || "z1-32b";

    if (!apiKey) {
      throw new Error(
        "ZAI_API_KEY environment variable is required. Please set it in your .env file."
      );
    }

    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ModelResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    });

    return {
      content: response.choices[0]?.message?.content || "",
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  async chatStream(
    messages: Message[],
    onChunk: (text: string) => void,
    options: ChatOptions = {}
  ): Promise<ModelResponse> {
    const stream = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      stream: true,
    });

    let fullContent = "";
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        fullContent += text;
        onChunk(text);
      }
    }

    return { content: fullContent };
  }
}

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
