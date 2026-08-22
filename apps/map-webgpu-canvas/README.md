# @salgil/map-webgpu-canvas

웹 대시보드에 iframe으로 임베드되는 WebGPU 기반 재난 시뮬레이션 3D 지도.
경북 안동·의성 일대의 실측 지형(AWS Terrain Tiles DEM) 위에 위성영상(Esri World
Imagery)을 드레이프하고, 강우량에 따라 다음을 GPU 컴퓨트 셰이더로 실시간
시뮬레이션한다.

- **강우/침수** — shallow-water(virtual pipe) 모델. 빗물이 실제 지형의 계곡과
  낙동강 유역으로 흘러 모여 침수가 확산된다.
- **산불** — 셀룰러 오토마타 확산(바람·경사·건조도·연료 반영). 연료맵은 위성영상
  녹색도에서 추출하므로 실제 산림 분포를 따라 번진다. 비가 오면 진화된다.
- **산사태** — 강우 누적 포화지수 × 경사 기반 위험도. 임계 초과 시 토석류
  파티클이 사면을 따라 흘러내리고, 위험 오버레이가 표시된다.
- **카메라** — 평면(2D 지도) ↔ 3D 틸트 전환. 시나리오 진입 시 회전 스윕과 함께
  전환된다. 드래그 회전/팬, 휠 줌, 터치 핀치 지원.

## 실행

```bash
yarn dev:map        # http://localhost:5183 (루트에서)
yarn build:map      # 타입체크 + 프로덕션 빌드
```

단독 실행 시 좌측에 개발용 컨트롤 패널(시나리오·강우량·뷰·재생 제어)이 뜬다.
iframe으로 임베드되면 패널은 자동으로 숨고 postMessage로만 제어한다.

## 대시보드 연동

통신 규격은 [PROTOCOL.md](PROTOCOL.md), 타입 정의는
[`src/protocol.ts`](src/protocol.ts) 참고. 요약:

- 명령(대시보드→지도): `map:set-scenario`, `map:set-rainfall`, `map:set-view`,
  `map:sim-control`, `map:ignite`, `map:ping`
- 이벤트(지도→대시보드): `map:ready`(georeference 포함), `map:state`(2 Hz),
  `map:hazard`(심각도 단계 변화), `map:ack`, `map:error`, `map:pong`

## 구조

```
src/
  protocol.ts     # iframe 메시지 계약 (source of truth)
  bridge.ts       # postMessage 송수신
  dem.ts          # 실측 DEM + 위성영상 로더 (실패 시 절차 생성 폴백)
  terrain-gen.ts  # 절차 생성 지형 폴백
  camera.ts       # 궤도 카메라, 평면↔3D 전환
  gpu/
    common.ts     # 공유 Globals 유니폼 + WGSL 프렐류드
    sim.ts        # 물(virtual pipe)·산불 CA·통계 리덕션 컴퓨트
    surface.ts    # 지형/수면 렌더 (vertex pulling)
    particles.ts  # 비·연기/불티·토석류 파티클
    engine.ts     # 디바이스·프레임 루프·시나리오·재해 이벤트 판정
  ui.ts           # 단독 실행용 컨트롤 패널
  main.ts         # 부트스트랩
```

성능 노트: 시뮬레이션은 256×256 격자 텍스처 핑퐁(고정 1/120 s 서브스텝),
파티클 최대 6.4만 개 전부 GPU 상주(스토리지 버퍼 + vertex pulling, CPU 왕복
없음), MSAA 4x, 재해 통계는 0.5초마다 원자 카운터 리덕션 후 비동기 리드백.

## 데이터 출처 / 주의

- 고도: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen terrarium)
- 영상: Esri World Imagery — 데모 용도. 프로덕션 배포 전 이용 약관 확인 필요.
- 배경 지도: TMAP MOBILITY. `VITE_TMAP_ENABLED=1`로 같은 출처의 타일 프록시를 활성화한다. 비활성화되거나 타일 로드에 실패하면 OpenStreetMap 데이터 기반 CARTO 지도로 대체된다. 대시보드에는 두 공급자 경로의 출처가 항상 표시된다.
- 수문 시간축은 시연을 위해 약 3600배 가속. 수치는 시각화용이며 예측값이 아님.
