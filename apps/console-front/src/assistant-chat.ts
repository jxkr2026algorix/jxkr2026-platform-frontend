/**
 * Streaming chat against the platform's assistant.
 *
 * The tool loop lives on the backend, not here: the government credentials for
 * the upstream data tools sit there, and the browser must never hold them. All
 * this does is post the transcript and read what comes back token by token.
 *
 * Tokens are streamed rather than awaited because the model reasons before it
 * answers. A blank panel for eight seconds reads as broken; a sentence forming
 * reads as thinking.
 */

export type ChatStreamEvent =
  | { kind: "tool"; name: string; round: number }
  | { kind: "notice"; text: string }
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; text: string };

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

const API_URL = import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform";

/** Whether the assistant can answer at all, so the panel can say so up front. */
export async function assistantStatus(): Promise<{
  configured: boolean;
  model: string;
}> {
  try {
    const response = await fetch(`${API_URL}/assistant/status`);
    if (!response.ok) return { configured: false, model: "" };
    return (await response.json()) as { configured: boolean; model: string };
  } catch {
    return { configured: false, model: "" };
  }
}

/**
 * Send a turn and yield events as they arrive. The returned function aborts
 * the request — closing the panel mid-answer should stop the work, not leave
 * it streaming into nothing.
 */
export function streamChat(
  messages: readonly ChatTurn[],
  onEvent: (event: ChatStreamEvent) => void,
): () => void {
  const controller = new AbortController();

  /**
   * The server sends its own `done` frame, and the stream then ends. Both used
   * to be reported, so the caller committed the finished answer twice and
   * every reply appeared in the transcript in duplicate. Every exit reports
   * exactly one `done`: the caller waits on it to settle the turn, and a path
   * that skips it leaves the composer disabled for good.
   */
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEvent({ kind: "done" });
  };

  void (async () => {
    try {
      const response = await fetch(`${API_URL}/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        onEvent({
          kind: "error",
          text: `assistant unavailable (${response.status})`,
        });
        finish();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; anything after the last
        // one is a partial frame and waits for the next chunk.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(5).trim()) as ChatStreamEvent;
            if (event.kind === "done") finish();
            else onEvent(event);
          } catch {
            // One malformed frame should not end the answer.
          }
        }
      }
      finish();
    } catch (error) {
      if (controller.signal.aborted) return;
      onEvent({
        kind: "error",
        text: error instanceof Error ? error.message : "assistant failed",
      });
      finish();
    }
  })();

  return () => controller.abort();
}
