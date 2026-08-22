# SALGIL 지도 iframe 통신 규격 (v1)

웹 대시보드는 이 앱(`@salgil/map-webgpu-canvas`)을 iframe으로 임베드하고, 모든 상호작용은
`window.postMessage`로만 이루어진다. 타입 정의의 원본은 [`src/protocol.ts`](src/protocol.ts)이며,
이 문서와 항상 동기화한다.

## 임베드

```html
<iframe
  src="https://map.example.com/?origin=https%3A%2F%2Fdashboard.example.com"
  allow="fullscreen"
  style="border:0; width:100%; height:100%"
></iframe>
```

### 쿼리 파라미터

| 파라미터 | 기본값 | 설명 |
| --- | --- | --- |
| `origin` | (없음) | 대시보드의 origin. 지정하면 수신 메시지의 `event.origin`을 이 값과 대조하고, 송신 메시지의 `targetOrigin`으로 사용한다. **프로덕션에서는 반드시 지정한다.** 미지정 시 프로토타입 편의를 위해 모든 origin을 허용하고 `*`로 송신한다. |
| `ui` | 자동 | `1`이면 내장 컨트롤 패널 강제 표시, `0`이면 강제 숨김. 기본: 최상위 창이면 표시, iframe이면 숨김. |
| `scenario` | `clear` | 초기 시나리오. |
| `rain` | 시나리오 기본값 | 초기 강우량(mm/h). |
| `lat`, `lon` | `36.361`, `128.690` | 지형 로드 중심 좌표. 기본값은 국가 행정경계 데이터에서 계산한 경상북도 본토 전역의 중심. |
| `km` | `186` | 로드할 정사각 영역의 한 변 길이(km). 기본값은 울릉군을 제외한 경북 22개 시·군이 모두 들어가는 최소 정사각형(+6% 여유). |
| `exagg` | 자동 | 수직 과장 배율. 기본: 80km 이상 3.2, 미만 1.6. |
| `terrain` | `real` | `procedural`이면 타일을 받지 않고 절차 생성 지형 사용. |

## 메시지 엔벨로프

모든 메시지는 아래 형태의 JSON 직렬화 가능한 객체다.

```jsonc
// 대시보드 → 지도
{ "source": "salgil-dashboard", "v": 1, "type": "map:set-rainfall", "payload": { "mmPerHour": 60 }, "id": "선택-상관ID" }

// 지도 → 대시보드
{ "source": "salgil-map", "v": 1, "type": "map:state", "payload": { /* ... */ } }
```

- `source`가 각각 `salgil-dashboard` / `salgil-map`이 아니면 무시한다.
- `v`(프로토콜 버전)가 다르면 무시한다. 호환이 깨지는 변경은 버전을 올린다.
- 명령에 `id`를 실으면 지도가 `map:ack`으로 동일한 `id`를 회신한다.

## 명령 (대시보드 → 지도)

| type | payload | 설명 |
| --- | --- | --- |
| `map:set-scenario` | `{ scenario, rainfallMmPerHour? }` | 시나리오 전환. `scenario`: `clear` \| `rain` \| `flood` \| `wildfire` \| `landslide`. 강우량 미지정 시 시나리오 기본값 적용(아래 표). |
| `map:set-rainfall` | `{ mmPerHour }` | 강우량 설정, 0–120. 강우량은 비 입자 밀도·물 고임·산불 진화·산사태 위험도를 함께 구동한다. |
| `map:set-view` | `{ mode }` | `flat`(2D 탑다운 지도), `tilted`(3D), `auto`. auto는 산불과 물 시각화가 핵심인 재난(`rain`/`flood`/`wildfire`/`landslide`/`tsunami`, 그리고 맑음+강우)에서 3D로 전환한다. 산불은 발화점 중심으로 3D 전환할 때 카메라가 천천히 회전해 진입한다. 수동 `flat`/`tilted`가 항상 우선. |
| `map:sim-control` | `{ action, speed? }` | `play` \| `pause` \| `reset`. `speed`는 0.25–4 배속. `reset`은 물·불·산사태 상태를 초기화한다. |
| `map:ignite` | `{ x, y }` | 정규화 좌표(0–1, 좌상단 원점)에 발화점 생성. (`map:trigger`의 산불 단축형) |
| `map:trigger` | `{ hazard, x, y }` | 지정 지점에 재난 발생. `wildfire`=발화, `flood`=국지성 침수(물 주입), `landslide`=토석류 발생. 지도 클릭도 현재 시나리오 기준으로 동일하게 동작한다(맑음 제외). |
| `map:set-overlay` | `{ enabled }` | 위험 지역 오버레이 토글(기본 켜짐). 시나리오별 취약지(침수·산불·산사태·액상화·해안 침수·온열/한랭/고립/용수)를 해칭으로 표시. |
| `map:set-basemap` | `{ style }` | 바닥 지도 전환: `satellite`(위성, 기본) \| `map`(구글맵풍 일반 지도, CARTO Voyager). 지도 타일은 백그라운드 로드되며 준비되는 즉시 크로스페이드. 현재 스타일은 `map:state.basemap`으로 보고. |
| `map:set-camera` | `{ center?, distanceMeters? }` | 3D 카메라 이동. `center`는 정규화 `{x,y}` 또는 실좌표 `{lat,lon}` 둘 다 허용(실좌표는 georeference 기준으로 변환하며, 실측 지형이 없으면 `map:ack`에 `no-georeference` 오류). 2D 맵과의 실시간 동기화 훅(아래 참조). 역방향 동기화는 `map:state.camera`로 제공. |
| `map:set-zones` | `{ zones: RiskZone[] }` | **(초안)** 서버에서 내려오는 위험 지역 폴리곤 표시. 전체 교체 방식이며 `[]`는 클리어. 각 zone은 주석 오버레이에 **점선 외곽선 + 옅은 채움**으로 그려지고, 중심점에 다크 블러 배지(아이콘+라벨, Pretendard GOV 12px)가 뜬다. 지형 셰이더에 칠하지 않고 캔버스 위 SVG로 그리므로 카메라 거리와 무관하게 선 두께가 일정하다. `polygon` 꼭짓점은 정규화 `{x,y}` 또는 위경도 `{lat,lon}` 둘 다 허용. `severity`(advisory/watch/warning)별 기본색 또는 `color: "#rrggbb"` 지정. `origin`(정규화 또는 위경도)은 모델이 예측한 발생 지점으로, 배지를 눌렀을 때 시뮬레이션이 시작되는 자리다 — 없으면 폴리곤 중심을 쓴다. `activatable: false` 를 주면 읽기 전용 주석이 된다. `polygon` 꼭짓점은 정규화 `{x,y}` 또는 위경도 `{lat,lon}` 둘 다 허용. `severity`(advisory/watch/warning)별 기본색 또는 `color: "#rrggbb"` 지정. **서버 데이터 스키마 확정 시 `applyZones()`(main.ts) 한 곳만 어댑터로 수정하면 된다.** |
| `map:set-markers` | `{ markers: MapMarker[] }` | 지점 주석(대피소·마을·시설·현장) 전체 교체. `[]`는 클리어. 각 marker는 `at`(정규화 또는 위경도), `label?`, `kind?`(`shelter`\|`community`\|`facility`\|`incident`\|`responder`), `color?`, `selected?`. 글리프+라벨 칩이 지형 위 해당 지점을 매 프레임 따라간다. |
| `map:set-routes` | `{ routes: MapRoute[] }` | 경로 주석(대피 경로·통제 도로) 전체 교체. `[]`는 클리어. 각 route는 `path`(꼭짓점 2개 이상), `label?`, `state?`(`open` 초록 실선 \| `advised` 주황 \| `blocked` 빨강 점선), `color?`. 라벨 칩은 경로 중간점에 붙는다. |
| `map:focus-district` | `{ code }` | 경북 시·군 선거구 포커스. `code`는 5자리 행정표준코드(예: 포항시 `47110`), `null` 또는 도 전체 코드 `47000`이면 비례대표(=도 전역) 뷰로 복귀. 해당 시·군의 실측 경계 상자에 맞춰 카메라를 이동하고 경계 오버레이에서 강조한다. 현재 로드된 지형 영역 밖의 시·군(현재는 울릉군뿐)은 지형을 다시 받아오므로 즉시 이동하지 않으며, 진행 중에는 `map:state.district.loading`이 `true`가 된다. |
| `map:set-district-overlay` | `{ enabled }` | 시·군 행정경계 오버레이 토글(기본 켜짐). 위험 지역 오버레이(`map:set-overlay`)와 독립적으로 동작한다. |
| `map:ping` | — | 생존 확인. `map:pong` 회신. |

### 시나리오 기본값

| scenario | 기본 강우량 | 효과 |
| --- | --- | --- |
| `clear` | 0 | 맑음. auto 뷰에서는 평면 지도. |
| `rain` | 24 mm/h | 강우 + 저지대 물 고임 시작. |
| `flood` | 96 mm/h | 집중호우, 유역 침수 확산. |
| `wildfire` | 0 | 건조 상태 + 능선 자동 발화, 바람에 의한 확산. 비가 오면 진화된다. |
| `landslide` | 72 mm/h | 지반 포화 누적 → 급경사면 토석류 발생. |
| `typhoon` | 85 mm/h | 동해안을 따라 북상하는 저기압 경로에 의한 회전풍 + 폭우. 침수·산사태 복합. |
| `earthquake` | 0 | 경주 인근 자동 발생(클릭으로 진앙 지정). 충격파 링, 진도 감쇠장, 카메라 진동, 급경사 낙석. |
| `tsunami` | 0 | 동해 해저 융기(클릭으로 진원 지정) → 천수 방정식으로 해안 전파·침수. 카메라가 해안으로 이동. |
| `nuclear` | 0 | 월성원전 기본(클릭으로 이동). 풍향 가우시안 플룸 + 방재구역(EPZ) 동심원. |
| `chemical` | 0 | 구미산단 기본(클릭으로 이동). 풍향 가우시안 플룸(황록색). |
| `heatwave` | 0 | 난색 그레이딩 + 저지대·분지 온열 위험 오버레이. 건조도 상승으로 산불 위험 증가. |
| `coldwave` | 0 | 한색 그레이딩 + 고지대 위험 오버레이, 고산 살얼음 적설. |
| `snow` | 45 mm/h(눈) | 눈 입자 + 산정에서 내려오는 적설, 산간 고립 위험 오버레이. 물은 고이지 않음. |
| `drought` | 0 | 식생 갈변, 하천·저수 고갈 가속, 용수 공급망 위험 오버레이, 산불 확산 가중. |

### `map:trigger`의 hazard 종류

`flood`(물 주입) · `wildfire`(발화) · `landslide`(토석류) · `earthquake`(진앙) ·
`tsunami`(해일 진원) · `nuclear` / `chemical`(누출원 이동). 지도 클릭은 현재
시나리오에 대응하는 hazard로 자동 매핑된다(폭염·한파·대설·가뭄·맑음은 클릭 무시).
`map:hazard` 이벤트의 `hazard` 필드도 동일 집합을 사용한다.

## 이벤트 (지도 → 대시보드)

| type | 시점 | payload 요약 |
| --- | --- | --- |
| `map:ready` | 초기화 완료 시, 그리고 `map:focus-district`로 지형 영역이 바뀔 때마다 | `{ protocolVersion, webgpuSupported, world: { gridSize, sizeMeters }, capabilities }`. **대시보드는 이 이벤트 수신 후에 명령을 보낸다.** 초기화 실패 시에도 `webgpuSupported: false`로 전송된다. |
| `map:state` | 약 2 Hz 스로틀 | `{ scenario, viewMode, rainfallMmPerHour, playing, speed, simTimeSeconds, fps, basemap, camera, district, hazards }`. `hazards`는 침수 면적비·연소 셀 수·산사태 위험지수와 각 심각도(`none`/`advisory`/`watch`/`warning`). `district`는 `{ selected, overlay, loading }`으로, 현재 포커스된 시·군 코드(도 전역이면 `null`)·경계 오버레이 표시 여부·지형 재로드 진행 여부. |
| `map:alert-activated` | 지도의 위험 경보 배지를 눌렀을 때 | `{ id, hazard, at }`. 예측 구역의 배지를 누르면 렌더러가 해당 시나리오로 전환하고 `origin`(없으면 폴리곤 중심)에서 시뮬레이션을 시작한 뒤 이 이벤트를 보낸다. **예측값이 시뮬레이션의 입력이 되는 지점이다.** |
| `map:point-selected` | 지도에서 지점 재난을 클릭했을 때 | `{ hazard, at }`. 대시보드는 이 좌표를 플랫폼 이벤트 POST에 사용한다. iframe 임베드 상태에서는 로컬 시뮬레이션이 기본 정지되어 최초 지점만 즉시 렌더링하며, 확산 상태는 서버 스트림 명령으로 갱신한다. |
| `map:hazard` | 심각도 단계 변화 시(에지 트리거) | `{ hazard, phase, severity, at? }`. `phase`: `started` \| `escalated` \| `deescalated` \| `ended`. `at`은 정규화 좌표. |
| `map:ack` | `id` 있는 명령 처리 직후 | `{ id, ok, error? }` |
| `map:error` | 오류 발생 시 | `{ code, message }`. `code`: `webgpu-unsupported` \| `device-lost` \| `bad-command` \| `internal` |
| `map:pong` | `map:ping` 수신 시 | `{}` |

## 대시보드 측 최소 구현 예시

```ts
const frame = document.querySelector("iframe")!;
const MAP_ORIGIN = "https://map.example.com";

window.addEventListener("message", (event) => {
  if (event.origin !== MAP_ORIGIN) return;
  const msg = event.data;
  if (msg?.source !== "salgil-map" || msg?.v !== 1) return;

  if (msg.type === "map:ready") {
    send({ type: "map:set-scenario", payload: { scenario: "rain" } });
  }
  if (msg.type === "map:hazard" && msg.payload.severity === "warning") {
    // 대시보드 알림 배너 갱신 등
  }
});

function send(command: { type: string; payload?: unknown }) {
  frame.contentWindow?.postMessage(
    { source: "salgil-dashboard", v: 1, ...command },
    MAP_ORIGIN,
  );
}
```

## 주석 오버레이

`map:set-zones` / `map:set-markers` / `map:set-routes`로 들어온 데이터는 **시뮬레이션과
분리된 표현 레이어**다. 렌더러 상태를 읽지도 바꾸지도 않으므로 잘못된 payload가 시뮬레이션을
망가뜨릴 수 없고, 세 레이어는 각각 독립적으로 전체 교체된다.

구현은 `src/annotations.ts`이고 두 층으로 나뉜다:

- **SVG 층** — zone 외곽선/채움, route 폴리라인. `viewBox`가 CSS 픽셀 단위라 선 두께가
  화면 기준으로 일정하다.
- **HTML 칩 층** — 라벨. Pretendard GOV와 backdrop blur가 필요해서 SVG `<text>`를 쓰지
  않는다. 위험 구역은 어두운 경고 칩, 장소는 밝은 참조 칩으로 구분한다.

두 층 모두 매 프레임 `engine.projectPointUnclipped()`로 재투영되므로 카메라가 움직여도
지형에 붙어 있다. 폴리곤은 화면 밖 꼭짓점도 유지하고(잘라내면 도형이 찢어진다), 칩만 화면
경계에서 숨긴다. 카메라 뒤로 넘어간 꼭짓점이 하나라도 있으면 그 도형 전체를 숨긴다.

### 위험 경보를 눌러 시뮬레이션 실행

`label` 이 있는 위험 구역 배지는 기본으로 **누를 수 있다**. 오버레이에서 포인터 입력을 받는
곳은 이 배지뿐이고, 나머지는 투명해서 지도를 그대로 끌 수 있다. 누르면 렌더러가
`hazard` 에 맞는 시나리오로 전환하고 `origin` 에서 재난을 발생시킨 뒤 재생을 시작한다.
시뮬레이션이 없는 재난이면 배지는 눌러도 아무 일도 하지 않고 상태 메시지만 띄운다.

`?demo=annotations`로 열면 청송군 진보면 기준 샘플 주석(위험 구역 2, 마커 4, 경로 2)이
실좌표로 로드된다. `src/demo-annotations.ts`는 개발용 픽스처이므로 플랫폼 스트림이 marker와
route를 싣기 시작하면 삭제한다.

## 좌표계

기본 지역은 경상북도 본토 전역(중심 36.361°N 128.690°E, 약 186 km × 186 km, 512×512
격자)이다. 이 범위는 국가 행정경계 데이터(통계청 SGIS 시군구 경계, WGS84)에서 울릉군을
제외한 21개 시·군을 모두 포함하는 최소 Web Mercator 정사각형으로 계산했으므로, 초기 화면에
경북 전역이 들어온다. 고도는 AWS Terrain Tiles(실측 DEM), 지표 텍스처와 식생(산불 연료)
분포는 Esri World Imagery에서 런타임에 로드한다. 타일 로드가 실패하면 절차 생성 지형으로
폴백한다. `?lat=&lon=&km=`으로 특정 시·군만 고해상도로 로드할 수도 있다(예: 안동
`?lat=36.52&lon=128.72&km=24`).

### 행정구역 데이터

경북 22개 시·군(군위군은 2023년 7월 대구 편입으로 제외)의 경계·중심점·경계상자는
`src/data/gyeongbuk-districts.json`(메타데이터)과 `src/data/gyeongbuk-boundaries.json`(경계
폴리곤)에 들어 있고, `scripts/build-gyeongbuk-districts.mjs`가 원본 국가 데이터에서
생성한다. 손으로 고치지 않는다. 좌표는 전부 실측값이며, 대시보드는
`@salgil/map-webgpu-canvas/districts`에서 메타데이터만 가져다 쓸 수 있다(경계 폴리곤은
렌더러 전용이라 번들에 포함되지 않는다).

모든 위치는 정규화 좌표 `{ x, y }`(0–1, 좌상단 원점)로 교환한다. 실측 지형이 로드된 경우
`map:ready`의 `world.georeference`(`{ centerLat, centerLon, west, east, north, south }`)가
포함되며, 정규화 좌표는 이 Web Mercator 바운딩 박스에 선형 대응한다(위도는 각도가 아니라
Mercator 투영값에 선형이다). 지역 변경은 쿼리 파라미터 `?lat=&lon=&km=` 또는
`map:focus-district`로 하며, 후자로 영역이 바뀌면 새 georeference를 담은 `map:ready`가
다시 전송된다.

## 2D 맵 ↔ 3D 뷰 실시간 동기화 가이드

대시보드가 기존 2D 맵(Leaflet 등)을 유지하고 이 3D 뷰를 옆에 띄우는 패턴:

1. **2D → 3D**: 2D 맵의 `moveend`/`zoomend`에서 중심 좌표를 georeference로 정규화해
   `map:set-camera { center: {x, y}, distanceMeters }` 전송. (줌 레벨 → 거리 변환은
   `distanceMeters ≈ 화면에 담을 폭(m) × 1.2` 정도가 자연스럽다.)
2. **3D → 2D**: `map:state`(2 Hz)의 `camera.center`/`camera.distanceMeters`를 받아
   2D 맵을 `setView`로 이동. 루프 방지를 위해 마지막으로 자신이 보낸 값과 비교해
   변화가 작으면 무시한다.
3. **상황 표시**: `map:state.hazards`와 `map:hazard`(위치 `at` 포함)를 2D 맵 위
   벡터 그래픽(원, 폴리곤, 아이콘)으로 그린다. 행정구역 클릭 시에는
   `map:set-camera`로 해당 구역을 확대하면 두 뷰가 함께 이동한다.

## v2 예약 (스펙 수령 후 구현)

- `map:set-forecast` — **산불 확산 예측 모델 API** 연동: 예측 확산 경로/등시선
  폴리곤을 받아 3D 지형 위에 오버레이. 모델 API 스펙 전달 대기 중.
- `map:set-markers` — 소방서·대피소 등 POI 마커 표시
- `map:set-route` — 위험도 기반 대피 경로 오버레이

## 시뮬레이션 스케일 주의

시연 목적상 수문 시간 스케일을 실제보다 약 3600배 가속했다(강우 1 mm/h ≈ 초당 1 mm 유입).
수치는 상대 비교·시각화용이며 실측 예측값이 아니다.
