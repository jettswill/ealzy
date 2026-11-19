import type { AppRepository } from "../../repository.js";
import { resolveCity } from "./cities.js";

export function sortPersonLocations<T extends { is_primary: boolean; created_at: string }>(
  locations: T[],
) {
  return [...locations].sort(
    (a, b) =>
      Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at),
  );
}

export function primaryLocation<T extends { is_primary: boolean; city: string }>(
  locations: T[] | null | undefined,
) {
  if (!locations?.length) return null;
  return locations.find((item) => item.is_primary) ?? locations[0] ?? null;
}

export function cityFromLocations(
  locations: { is_primary: boolean; city: string }[] | null | undefined,
) {
  const city = primaryLocation(locations)?.city?.trim();
  return city || null;
}

export function compactLocations(
  locations:
    | {
        label: string | null;
        city: string;
        address: string | null;
        is_primary: boolean;
      }[]
    | null
    | undefined,
) {
  return (locations ?? []).slice(0, 6).map((location) => ({
    label: location.label,
    city: location.city,
    address: location.address,
    is_primary: location.is_primary,
  }));
}

/** Свой город человека: основной адрес в карточке «Я», приведённый к справочнику. */
export async function ownCity(repository: AppRepository, ownerId: string): Promise<string | null> {
  const self = await repository.getSelfPerson(ownerId);
  const city = cityFromLocations(self?.locations);
  if (!city) return null;
  return resolveCity(city)?.title ?? city;
}

/**
 * Запомнить город человека (название из справочника): обновить основной адрес
 * или завести его. Город сменился — старый адрес улицы к нему уже не относится.
 * true — что-то записали.
 */
export async function saveOwnCity(
  repository: AppRepository,
  ownerId: string,
  title: string,
): Promise<boolean> {
  const self = await repository.getSelfPerson(ownerId);
  if (!self) return false;
  const locations = await repository.listLocations(ownerId, self.id);
  const primary = primaryLocation(locations);
  if (primary) {
    const current = resolveCity(primary.city)?.title ?? primary.city.trim();
    if (current === title) return false;
    await repository.updateLocation(ownerId, primary.id, {
      city: title,
      address: null,
      is_primary: true,
    });
    return true;
  }
  await repository.createLocation(ownerId, self.id, {
    label: null,
    city: title,
    address: null,
    is_primary: true,
  });
  return true;
}
