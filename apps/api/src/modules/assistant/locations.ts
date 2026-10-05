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
