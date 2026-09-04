/**
 * LLM Abstraction Layer — environment-agnostic, no Manus-specific dependencies
 *
 * Priority order:
 *   1. Local Ollama  (OLLAMA_BASE_URL, default http://localhost:11434)
 *   2. Generic OpenAI-compatible API  (LLM_API_URL + LLM_API_KEY)
 *   3. OpenAI directly  (OPENAI_API_KEY)
 */
import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";
export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type FileContent = { type: "file_url"; file_url: { url: string; mime_type?: string } };
export type MessageContent = string | TextContent | ImageContent | FileContent;
export type Message = { role: Role; content: MessageContent | MessageContent[]; name?: string; tool_call_id?: string };
export type Tool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = { type: "function"; function: { name: string } };
export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type JsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type OutputSchema = JsonSchema;
export type ResponseFormat = { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: JsonSchema };
export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
};
export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{ index: number; message: { role: Role; content: string | Array<TextContent | ImageContent | FileContent>; tool_calls?: ToolCall[] }; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

type LLMBackend = { baseUrl: string; apiKey: string; defaultModel: string; name: string };

export function resolveBackend(): LLMBackend {
  if (ENV.ollamaBaseUrl) {
    return { baseUrl: ENV.ollamaBaseUrl, apiKey: "ollama", defaultModel: ENV.ollamaDefaultModel || "gemma3:8b", name: "ollama" };
  }
  if (ENV.llmApiUrl && ENV.llmApiKey) {
    return { baseUrl: ENV.llmApiUrl, apiKey: ENV.llmApiKey, defaultModel: ENV.llmDefaultModel || "gpt-4o-mini", name: "openai-compatible" };
  }
  if (ENV.openAiApiKey) {
    return { baseUrl: "https://api.openai.com", apiKey: ENV.openAiApiKey, defaultModel: ENV.llmDefaultModel || "gpt-4o-mini", name: "openai" };
  }
  throw new Error("[LLM] No backend configured. Set OLLAMA_BASE_URL, LLM_API_URL+LLM_API_KEY, or OPENAI_API_KEY.");
}

const ensureArray = (v: MessageContent | MessageContent[]): MessageContent[] => Array.isArray(v) ? v : [v];

const normalizeContentPart = (part: MessageContent): TextContent | ImageContent => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "file_url") return { type: "text", text: `[File: ${(part as FileContent).file_url.url}]` };
  return part as TextContent | ImageContent;
};

const normalizeMessage = (msg: Message): Record<string, unknown> => {
  if (msg.role === "tool" || msg.role === "function") {
    const content = ensureArray(msg.content).map(p => typeof p === "string" ? p : JSON.stringify(p)).join("\n");
    return { role: msg.role, name: msg.name, tool_call_id: msg.tool_call_id, content };
  }
  const parts = ensureArray(msg.content).map(normalizeContentPart);
  const collapsed = parts.length === 1 && parts[0].type === "text" ? (parts[0] as TextContent).text : parts;
  return { role: msg.role, ...(msg.name ? { name: msg.name } : {}), content: collapsed };
};

const normalizeToolChoice = (tc: ToolChoice | undefined, tools: Tool[] | undefined): unknown => {
  if (!tc || !tools?.length) return undefined;
  if (typeof tc === "string") {
    if (tc === "required") {
      if (tools.length === 1) return { type: "function", function: { name: tools[0].function.name } };
      return "auto";
    }
    return tc;
  }
  if ("name" in tc) return { type: "function", function: { name: tc.name } };
  return tc;
};

const normalizeResponseFormat = (p: { responseFormat?: ResponseFormat; response_format?: ResponseFormat; outputSchema?: OutputSchema; output_schema?: OutputSchema }): ResponseFormat | undefined => {
  const explicit = p.responseFormat ?? p.response_format;
  if (explicit) return explicit;
  const schema = p.outputSchema ?? p.output_schema;
  if (!schema) return undefined;
  return { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, ...(schema.strict !== undefined ? { strict: schema.strict } : {}) } };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const backend = resolveBackend();
  const model = params.model ?? backend.defaultModel;
  const payload: Record<string, unknown> = {
    model,
    messages: params.messages.map(normalizeMessage),
    max_tokens: params.maxTokens ?? params.max_tokens ?? 4096,
  };
  if (params.tools?.length) payload.tools = params.tools;
  const tc = normalizeToolChoice(params.toolChoice ?? params.tool_choice, params.tools);
  if (tc) payload.tool_choice = tc;
  const rf = normalizeResponseFormat({ responseFormat: params.responseFormat, response_format: params.response_format, outputSchema: params.outputSchema, output_schema: params.output_schema });
  if (rf) payload.response_format = backend.name === "ollama" && rf.type === "json_schema" ? { type: "json_object" } : rf;
  const url = `${backend.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${backend.apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[LLM:${backend.name}] ${response.status} ${response.statusText} — ${errorText}`);
  }
  return (await response.json()) as InvokeResult;
}

export async function checkOllamaStatus(): Promise<{ online: boolean; version?: string }> {
  const url = (ENV.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false };
    const data = await res.json() as { version?: string };
    return { online: true, version: data.version };
  } catch { return { online: false }; }
}

export async function listOllamaModels(): Promise<Array<{ name: string; size: number; modified_at: string }>> {
  const url = (ENV.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as { models?: Array<{ name: string; size: number; modified_at: string }> };
    return data.models ?? [];
  } catch { return []; }
}

export async function pullOllamaModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  const url = (ENV.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
  try {
    const res = await fetch(`${url}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return { success: false, error: await res.text() };
    return { success: true };
  } catch (e) { return { success: false, error: String(e) }; }
}
