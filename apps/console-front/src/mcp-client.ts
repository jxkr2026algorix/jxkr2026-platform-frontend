import ky from "ky";
import { z } from "zod";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_ENDPOINT = "/api/mcp";

const errorResponseSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
});

const initializeResponseSchema = z.object({
  result: z.object({
    serverInfo: z.object({
      name: z.string(),
      title: z.string().optional(),
      version: z.string(),
    }),
  }),
});

const toolsResponseSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        title: z.string().optional(),
      }),
    ),
  }),
});

const toolCallResponseSchema = z.object({
  result: z.object({
    content: z.array(
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
    ),
    isError: z.boolean().optional(),
  }),
});

const eventResponseSchema = z
  .object({ id: z.union([z.number(), z.string()]) })
  .passthrough();

export type McpConnection = {
  readonly serverTitle: string;
  readonly toolCount: number;
};

export class McpRequestError extends Error {
  readonly name = "McpRequestError";
}

let requestId = 0;
let sessionId: string | null = null;

function parseEventStream(body: string, expectedId: number): unknown {
  const events = body.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = eventResponseSchema.safeParse(JSON.parse(data));
      if (parsed.success && parsed.data.id === expectedId) {
        return parsed.data;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new McpRequestError(
    "The data service returned an invalid event stream.",
  );
}

async function parseMcpResponse(
  response: Response,
  expectedId: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseEventStream(await response.text(), expectedId);
  }
  return response.json();
}

async function postMcp(
  method: string,
  params: unknown,
  recoverSession = true,
): Promise<unknown> {
  requestId += 1;
  const currentRequestId = requestId;
  const response = await ky.post(MCP_ENDPOINT, {
    headers: {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(method !== "initialize" && sessionId
        ? { "Mcp-Session-Id": sessionId }
        : {}),
    },
    json: {
      jsonrpc: "2.0",
      id: currentRequestId,
      method,
      params,
    },
    retry: { limit: 1, methods: ["post"] },
    throwHttpErrors: false,
    timeout: 30_000,
  });
  if (response.status === 404 && sessionId && recoverSession) {
    sessionId = null;
    await initializeMcpSession();
    return postMcp(method, params, false);
  }
  if (!response.ok) {
    throw new McpRequestError(
      "The data service could not complete the request.",
    );
  }
  if (method === "initialize") {
    sessionId = response.headers.get("Mcp-Session-Id");
  }
  return parseMcpResponse(response, currentRequestId);
}

async function notifyMcp(method: string, params: unknown): Promise<void> {
  const response = await ky.post(MCP_ENDPOINT, {
    headers: {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    json: { jsonrpc: "2.0", method, params },
    retry: { limit: 1, methods: ["post"] },
    throwHttpErrors: false,
    timeout: 30_000,
  });
  if (!response.ok) {
    throw new McpRequestError("The data service rejected initialization.");
  }
}

function throwIfMcpError(value: unknown): void {
  const parsed = errorResponseSchema.safeParse(value);
  if (parsed.success) {
    throw new McpRequestError(parsed.data.error.message);
  }
}

async function initializeMcpSession(): Promise<
  z.infer<typeof initializeResponseSchema>
> {
  sessionId = null;
  const initializeValue = await postMcp("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "salgil-console", version: "0.0.0" },
  });
  throwIfMcpError(initializeValue);
  const initialized = initializeResponseSchema.safeParse(initializeValue);
  if (!initialized.success) {
    throw new McpRequestError(
      "The data service returned an invalid handshake.",
    );
  }
  await notifyMcp("notifications/initialized", {});
  return initialized.data;
}

export async function connectMcp(): Promise<McpConnection> {
  const initialized = await initializeMcpSession();

  const toolsValue = await postMcp("tools/list", {});
  throwIfMcpError(toolsValue);
  const tools = toolsResponseSchema.safeParse(toolsValue);
  if (!tools.success) {
    throw new McpRequestError(
      "The data service returned an invalid tool list.",
    );
  }

  return {
    serverTitle:
      initialized.result.serverInfo.title ?? initialized.result.serverInfo.name,
    toolCount: tools.data.result.tools.length,
  };
}

export async function callMcpTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const value = await postMcp("tools/call", { name, arguments: args });
  throwIfMcpError(value);
  const parsed = toolCallResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.result.isError === true) {
    throw new McpRequestError("The data source could not complete this query.");
  }
  const content = parsed.data.result.content[0];
  if (!content) {
    throw new McpRequestError("The data source returned no readable result.");
  }
  try {
    return JSON.parse(content.text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new McpRequestError("The data source returned invalid JSON.", {
        cause: error,
      });
    }
    throw error;
  }
}
