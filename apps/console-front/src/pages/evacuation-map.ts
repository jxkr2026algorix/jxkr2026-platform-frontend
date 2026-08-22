import { DISTRICTS, districtByCode } from "@salgil/map-webgpu-canvas/districts";

export function originFor(districtCode: string | null): {
  lat: number;
  lon: number;
  label: string;
} {
  const district = districtCode ? districtByCode(districtCode) : undefined;
  if (!district) {
    return { lat: 36.4361, lon: 129.0572, label: "Cheongsong-gun" };
  }
  return {
    lat: district.center[1],
    lon: district.center[0],
    label: district.nameEn,
  };
}

export function closureRing(
  lat: number,
  lon: number,
  radiusMeters: number,
): { lat: number; lon: number }[] {
  const latDegrees = radiusMeters / 110574;
  const lonDegrees = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;
    return {
      lat: lat + Math.sin(angle) * latDegrees,
      lon: lon + Math.cos(angle) * lonDegrees,
    };
  });
}

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
