export interface ParsedToolCall {
  id: string;
  name: string;
  args: string;
}

const DISPLAY_TEXT_KEYS = ["answer", "response", "message", "content", "output", "final", "final_answer", "summary", "text"] as const;

function stripJsonCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function isLikelyJsonContent(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("```");
}

function normalizeToolArguments(rawArguments: unknown): string | null {
  if (rawArguments === undefined || rawArguments === null) {
    return "{}";
  }

  if (typeof rawArguments === "string") {
    const trimmed = rawArguments.trim();
    if (!trimmed) {
      return "{}";
    }

    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }

  try {
    return JSON.stringify(rawArguments);
  } catch {
    return null;
  }
}

function normalizeToolName(rawName: string): { name: string; attachedArgs?: string } | null {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }

  const attachedArgsMatch = trimmed.match(/^([A-Za-z0-9_.:-]+)\s*(\{[\s\S]*\})$/);
  const name = attachedArgsMatch ? attachedArgsMatch[1] : trimmed;

  if (!name || name.toLowerCase() === "none") {
    return null;
  }

  return {
    name,
    attachedArgs: attachedArgsMatch?.[2],
  };
}

function parseInlineToolCallPayload(payload: unknown, index: number): ParsedToolCall | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const functionRecord =
    record.function && typeof record.function === "object" && !Array.isArray(record.function)
      ? (record.function as Record<string, unknown>)
      : null;

  const declaredType = typeof record.type === "string" ? record.type : undefined;
  if (declaredType && declaredType !== "function") {
    return null;
  }

  const rawName =
    (typeof record.call === "string" && record.call) ||
    (typeof record.name === "string" && record.name) ||
    (typeof functionRecord?.name === "string" && functionRecord.name) ||
    null;

  if (!rawName) {
    return null;
  }

  const normalizedName = normalizeToolName(rawName);
  if (!normalizedName) {
    return null;
  }

  const args = normalizeToolArguments(record.arguments ?? functionRecord?.arguments ?? normalizedName.attachedArgs ?? {});
  if (!args) {
    return null;
  }

  return {
    id: `inline-tool-call-${index}-${normalizedName.name}`,
    name: normalizedName.name,
    args,
  };
}

function getInlineToolCallPayloads(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.tool_calls)) {
      return record.tool_calls;
    }
  }

  return [payload];
}

function extractDisplayText(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  if (Array.isArray(payload)) {
    const textParts = payload
      .map((item) => extractDisplayText(item))
      .filter((item): item is string => Boolean(item));

    return textParts.length > 0 ? textParts.join("\n\n") : null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of DISPLAY_TEXT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function parseInlineToolCallsFromContent(content?: string | null): ParsedToolCall[] {
  if (!content) {
    return [];
  }

  if (!isLikelyJsonContent(content)) {
    return [];
  }

  try {
    const parsed = JSON.parse(stripJsonCodeFence(content));
    const rawCalls = getInlineToolCallPayloads(parsed);
    return rawCalls
      .map((call, index) => parseInlineToolCallPayload(call, index))
      .filter((call): call is ParsedToolCall => Boolean(call));
  } catch {
    return [];
  }
}

export function extractDisplayTextFromContent(content?: string | null): string | null {
  if (!content) {
    return null;
  }

  if (!isLikelyJsonContent(content)) {
    return content;
  }

  try {
    return extractDisplayText(JSON.parse(stripJsonCodeFence(content)));
  } catch {
    return null;
  }
}
