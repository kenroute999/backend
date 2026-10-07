import { config } from "../../core/config";
import { prisma } from "../../core/db";

// Where a boarding or dropping point is on the map. Routes only hold the names of their
// stops, so the position is looked up once by name (OpenStreetMap's free search) and kept.
//
// ponytail: a name search can land on the wrong spot or find nothing, and the free search
// allows about one question a second. If stops must be exact, let the owner pin each stop
// on a map in Admin and store that instead.

export interface Place {
  latitude: number;
  longitude: number;
}

export async function findPlace(stop: string, city: string): Promise<Place | null> {
  const query = `${stop}, ${city}, India`.toLowerCase().replace(/\s+/g, " ").trim();
  const known = await prisma.geoPlace.findUnique({ where: { query } });
  if (known) return known.latitude !== null && known.longitude !== null ? { latitude: known.latitude, longitude: known.longitude } : null;
  // Tests never go out to the internet.
  if (config.nodeEnv === "test") return null;

  let place: Place | null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": "KenRoute bus tracking" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    place = hit ? { latitude: Number(hit.lat), longitude: Number(hit.lon) } : null;
  } catch {
    return null; // search is down: ask again next time rather than remember a miss
  }
  // "Not found" is remembered too, so the same unknown name is not asked again and again.
  await prisma.geoPlace
    .create({ data: { query, latitude: place?.latitude ?? null, longitude: place?.longitude ?? null } })
    .catch(() => {}); // two passengers asked at once: the other one saved it
  return place;
}

/** Kilometres between two points, as the crow flies. */
export function distanceKm(a: Place, b: Place): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
