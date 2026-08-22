import { createServer } from "node:http";
import {
  DEMO_LOCATION,
  mobileSessionSchema,
  platformEventSchema,
} from "../apps/platform-client/src/contracts.ts";

const port = Number(process.env.PLATFORM_DEMO_PORT ?? 41734);
const clients = new Set();
let sequence = 0;
let lastEvent = null;

const mobileAssignments = [
  {
    currentLocation: { x: 0.3, y: 0.68, label: "진보면 주민 대피 지점" },
    shelter: { x: 0.74, y: 0.28, label: "진보문화체육센터" },
    route: [{ x: 0.3, y: 0.68, label: "현재 위치" }, { x: 0.48, y: 0.51, label: "안전 이동 구간" }, { x: 0.74, y: 0.28, label: "대피소" }],
    riskZones: [{ id: "forest", label: "산불 확산 예측 구역", hazard: "산불", severity: "warning", color: "#ea580c", polygon: [{ x: 0.08, y: 0.15 }, { x: 0.42, y: 0.12 }, { x: 0.48, y: 0.4 }, { x: 0.14, y: 0.45 }] }],
    caution: "산불 확산 예측 구역을 피해 안내된 도로로 이동하세요.",
    estimatedMinutes: 8,
  },
  {
    currentLocation: { x: 0.24, y: 0.72, label: "진보면 현동로 42" },
    shelter: { x: 0.68, y: 0.31, label: "진보초등학교 강당" },
    route: [{ x: 0.24, y: 0.72, label: "현재 위치" }, { x: 0.43, y: 0.55, label: "안전 이동 구간" }, { x: 0.68, y: 0.31, label: "대피소" }],
    riskZones: [{ id: "slope", label: "급경사지 위험 구역", hazard: "산사태", severity: "warning", color: "#dc2626", polygon: [{ x: 0.1, y: 0.16 }, { x: 0.35, y: 0.18 }, { x: 0.42, y: 0.46 }, { x: 0.17, y: 0.5 }] }],
    caution: "급경사지와 계곡 방향을 피하고 안내된 도로만 이용하세요.",
    estimatedMinutes: 11,
  },
] as const;

const headers = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function sendStream(message) {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  for (const response of clients) response.write(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) request.destroy();
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/events/stream") {
    response.writeHead(200, {
      ...headers,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    clients.add(response);
    response.write(": connected\n\n");
    if (lastEvent) {
      response.write(
        `data: ${JSON.stringify({ kind: "disaster.event", event: lastEvent })}\n\n`,
      );
    }
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "GET" && request.url === "/mobile/session") {
    const assignment = mobileAssignments[Math.floor(Math.random() * mobileAssignments.length)];
    const session = mobileSessionSchema.parse({ id: crypto.randomUUID(), ...assignment });
    response.writeHead(200, { ...headers, "Content-Type": "application/json" });
    response.end(JSON.stringify(session));
    return;
  }

  if (request.method === "POST" && request.url === "/events") {
    try {
      const draft = JSON.parse(await readBody(request));
      const createdAt = new Date().toISOString();
      sequence += 1;
      const fallbackCopy = {
        rain: ["청송군에 강한 비가 내리고 있습니다", "하천과 저지대 접근을 피하세요."],
        flood: ["저지대 침수 위험이 감지되었습니다", "높은 곳으로 이동할 준비를 하세요."],
        wildfire: ["공동 데모 지점 인근에서 산불이 감지되었습니다", "연기 반대 방향으로 이동하세요."],
        landslide: ["급경사지 붕괴 위험이 높아졌습니다", "산비탈과 계곡을 피하세요."],
        earthquake: ["경북 지역에 지진이 감지되었습니다", "머리를 보호하고 넓은 곳으로 이동하세요."],
        typhoon: ["태풍 영향권에 진입했습니다", "외출을 멈추고 실내에 머무르세요."],
        heatwave: ["폭염 경보가 발효되었습니다", "야외 활동을 줄이고 수분을 섭취하세요."],
        snow: ["산간 도로에 대설 위험이 있습니다", "불필요한 이동을 멈추세요."],
      };
      const copy = fallbackCopy[draft.type];
      const needsLocation = [
        "wildfire",
        "flood",
        "landslide",
        "earthquake",
      ].includes(draft.type);
      const candidate = {
        id: crypto.randomUUID(),
        sequence,
        type: draft.type,
        mode: draft.mode,
        phase: ["initial", "update", "resolved"].includes(draft.phase)
          ? draft.phase
          : "initial",
        presentation: ["wildfire", "flood", "landslide"].includes(draft.type)
          ? "3d"
          : "2d",
        headline: copy?.[0] ?? "새 재난 이벤트가 발생했습니다",
        instruction: copy?.[1] ?? "플랫폼 안내를 확인하세요.",
        createdAt,
        ...(draft.location
          ? { location: draft.location }
          : needsLocation
            ? { location: DEMO_LOCATION }
            : {}),
        ...(draft.rainfallMmPerHour !== undefined
          ? { rainfallMmPerHour: draft.rainfallMmPerHour }
          : {}),
        ...(Array.isArray(draft.zones) ? { zones: draft.zones } : {}),
      };
      lastEvent = platformEventSchema.parse(candidate);
      sendStream({ kind: "disaster.event", event: lastEvent });
      sendStream({
        kind: "control.sync",
        mode: lastEvent.mode,
        selectedType: lastEvent.type,
      });
      response.writeHead(200, {
        ...headers,
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(lastEvent));
    } catch (error) {
      response.writeHead(400, {
        ...headers,
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ error: "invalid-event" }));
    }
    return;
  }

  response.writeHead(404, headers);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SALGIL platform demo relay: http://127.0.0.1:${port}`);
});
