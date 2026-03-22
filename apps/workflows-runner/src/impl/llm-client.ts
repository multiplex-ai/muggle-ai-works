import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

function stripMarkdownFences(text: string): string {
  // Strip ```json ... ``` or ``` ... ``` fences
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const match = text.trim().match(fencePattern);
  if (match) {
    return match[1].trim();
  }
  return text.trim();
}

export function createJsonLLMClient<T>(
  model: string = DEFAULT_MODEL
): (prompt: string) => Promise<T> {
  const client = new Anthropic();

  return async (prompt: string): Promise<T> => {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const firstContent = response.content[0];
    if (!firstContent || firstContent.type !== "text") {
      throw new Error(
        `Unexpected response content type: ${firstContent?.type ?? "none"}`
      );
    }

    const rawText = firstContent.text;
    const stripped = stripMarkdownFences(rawText);

    try {
      return JSON.parse(stripped) as T;
    } catch (err) {
      throw new Error(
        `Failed to parse LLM response as JSON.\n` +
          `Parse error: ${err instanceof Error ? err.message : String(err)}\n` +
          `Raw response:\n${rawText}`
      );
    }
  };
}
