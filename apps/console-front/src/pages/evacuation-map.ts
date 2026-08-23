import { DISTRICTS } from "@salgil/map-webgpu-canvas/districts";

export function districtAt(lat: number, lon: number): string | null {
  const district = DISTRICTS.find(
    (candidate) =>
      lon >= candidate.bbox[0] &&
      lon <= candidate.bbox[2] &&
      lat >= candidate.bbox[1] &&
      lat <= candidate.bbox[3],
  );
  return district?.code ?? null;
}
