import type { AppRepository } from "../../repository.js";
import type { ActivityCatalog, ActivityType, Outing, Place } from "../../types.js";

/** Календарная дата в часовом поясе человека (YYYY-MM-DD). */
const localDate = (timeZone: string, at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

// «Пойду»: человек выбрал, куда сходить. План — место в дневнике со статусом
// «хочу», время и дело в календаре (а на iPhone — событие в календаре телефона).
// Без времени Илзи вечером спросит, когда он пойдёт; в день выхода — как было.

const DAY = 24 * 3600_000;

/** Куда человек собрался: «хочу» за последние две недели, с названием места и занятия. */
export async function listOutings(
  repository: Pick<AppRepository, "listPlaceVisits" | "listPlaces">,
  ownerId: string,
  catalog: ActivityCatalog,
  at = new Date(),
): Promise<Outing[]> {
  const visits = (await repository.listPlaceVisits(ownerId)).filter(
    (visit) =>
      visit.status === "want" &&
      visit.place_id &&
      (Date.parse(visit.updated_at) > at.getTime() - 14 * DAY ||
        (visit.planned_for && Date.parse(visit.planned_for) > at.getTime() - 2 * DAY)),
  );
  if (!visits.length) return [];
  const places = await repository.listPlaces({ ids: visits.map((v) => v.place_id!), limit: 50 });
  const byId = new Map(places.map((place) => [place.id, place]));
  const types = new Map(catalog.types.map((type) => [type.id, type]));
  return visits.flatMap((visit) => {
    const place = byId.get(visit.place_id!);
    if (!place) return [];
    const type = visit.activity_type_id ? types.get(visit.activity_type_id) : undefined;
    return [
      {
        visit_id: visit.id,
        place_id: place.id,
        place: place.name,
        address: place.address,
        phone: place.phone,
        website: place.website,
        activity: type?.name ?? null,
        activity_type_id: type?.id ?? null,
        emoji: type?.emoji ?? null,
        planned_for: visit.planned_for ?? null,
        task_id: visit.task_id ?? null,
        updated_at: visit.updated_at,
      },
    ];
  });
}

/** Вечерний вопрос: собрался, а когда — не сказал (не старше недели, не моложе 6 часов). */
export function outingsWithoutDate(outings: Outing[], at = new Date()) {
  return outings
    .filter(
      (o) =>
        !o.planned_for &&
        Date.parse(o.updated_at) < at.getTime() - 6 * 3600_000 &&
        Date.parse(o.updated_at) > at.getTime() - 7 * DAY,
    )
    .slice(0, 2);
}

/** «Как было?»: выход был сегодня (по местному времени) и уже прошёл. */
export function outingsToReview(outings: Outing[], timeZone: string, at = new Date()) {
  const today = localDate(timeZone, at);
  return outings
    .filter(
      (o) =>
        o.planned_for &&
        Date.parse(o.planned_for) < at.getTime() &&
        localDate(timeZone, new Date(o.planned_for)) === today,
    )
    .slice(0, 2);
}

/** Дело в календаре под выход: что, где, как связаться и как добраться. */
export function outingTask(
  type: Pick<ActivityType, "name" | "emoji" | "duration_hours"> | undefined,
  place: Pick<Place, "name" | "address" | "phone" | "website" | "lat" | "lon" | "city">,
  mapsUrl: string | null,
) {
  const title = type
    ? `${type.emoji ? `${type.emoji} ` : ""}${type.name}: ${place.name}`
    : place.name;
  const route =
    place.lat != null && place.lon != null
      ? `https://yandex.ru/maps/?rtext=~${place.lat},${place.lon}&rtt=auto`
      : mapsUrl;
  const description = [
    place.address ? `Адрес: ${place.address}${place.city ? `, ${place.city}` : ""}` : null,
    place.phone ? `Телефон: ${place.phone}` : null,
    place.website ? `Сайт: ${place.website}` : null,
    route ? `Как добраться: ${route}` : null,
    "Из колеса «Удиви меня»",
  ]
    .filter(Boolean)
    .join("\n");
  const minutes = Math.round(Math.min(8, Math.max(1, type?.duration_hours ?? 2)) * 60);
  return { title: title.slice(0, 300), description: description.slice(0, 4000), minutes };
}

/**
 * «Пойду» — слабый, но плюс: тип чуть выше, если раньше он был ниже середины.
 * Сильные сигналы (оценка после визита) не перетираем.
 */
export async function learnFromIntent(
  repository: Pick<AppRepository, "listActivityPreferences" | "patchActivityPreference">,
  ownerId: string,
  type: Pick<ActivityType, "id" | "category_id">,
) {
  const rows = await repository.listActivityPreferences(ownerId);
  const own = rows.find((r) => r.target_kind === "type" && r.target_id === type.id);
  const current = own?.visit_affinity ?? 0;
  if (current >= 0.5) return;
  await repository.patchActivityPreference(ownerId, {
    target_kind: "type",
    target_id: type.id,
    visit_affinity: Math.min(0.5, current + 0.15),
  });
}

const timeOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

/** Строки сводки: вечером — «когда пойдёшь?» и «как было?», утром — сегодняшний выход. */
export function outingDigestLines(
  kind: "morning_digest" | "weekly_digest" | "evening_sync" | string,
  outings: Outing[],
  timeZone: string,
  ru: boolean,
  at = new Date(),
): string[] {
  const label = (o: Outing) => `${o.emoji ? `${o.emoji} ` : ""}${o.place}`;
  if (kind === "morning_digest") {
    const today = localDate(timeZone, at);
    const todays = outings.filter(
      (o) => o.planned_for && localDate(timeZone, new Date(o.planned_for)) === today,
    );
    return todays
      .slice(0, 2)
      .map((o) =>
        ru
          ? `Сегодня в ${timeOf(o.planned_for!, timeZone)} — ${label(o)}${o.address ? `, ${o.address}` : ""}.`
          : `Today at ${timeOf(o.planned_for!, timeZone)} — ${label(o)}.`,
      );
  }
  if (kind !== "evening_sync") return [];
  const lines: string[] = [];
  for (const o of outingsToReview(outings, timeZone, at))
    lines.push(
      ru
        ? `Как сходил в ${label(o)}? Пара слов — и я лучше пойму, что тебе предлагать.`
        : `How was ${label(o)}? A couple of words help me suggest better.`,
    );
  const open = outingsWithoutDate(outings, at);
  if (open.length)
    lines.push(
      ru
        ? `Ты собирался: ${open.map(label).join(", ")}. Когда пойдёшь? Напиши день и время — поставлю в календарь.`
        : `You planned to go: ${open.map(label).join(", ")}. When? Tell me a day and time — I'll put it on the calendar.`,
    );
  return lines;
}
