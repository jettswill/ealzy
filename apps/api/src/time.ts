/**
 * Дела без названного времени ставятся «на середину дня». Раньше серединой дня
 * везде был литерал `T12:00:00.000Z` — то есть 15:00 в Москве, 17:00 в Тбилиси
 * и 22:00 во Владивостоке. Человек просил «завтра», а получал дело вечером,
 * и утренняя сводка показывала его не тем часом.
 *
 * Здесь полдень считается в поясе пользователя. Два прохода нужны из-за
 * переходов на летнее время: первый даёт смещение, второй проверяет, что после
 * поправки мы всё ещё в том же дне и в том же смещении.
 */
export function localMidday(dateKey: string, timezone: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 12);
  let zone = timezone || "UTC";
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = zonedFormatter(zone);
  } catch {
    zone = "UTC";
    formatter = zonedFormatter(zone);
  }
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year ?? year,
      (parts.month ?? month) - 1,
      parts.day ?? day,
      parts.hour ?? 12,
      parts.minute ?? 0,
      parts.second ?? 0,
    );
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}

function zonedFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}
