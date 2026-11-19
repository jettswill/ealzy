"""Собирает supabase/migrations/041_activity_catalog_seed.sql из справочника и базы Guide-App.

Запуск из корня репозитория: python3 data/activities/build_seed.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
types = json.load(open(ROOT / "data/activities/activity_types.json", encoding="utf-8"))
guide = json.load(open(ROOT / "data/places/places.json", encoding="utf-8"))

CATEGORIES = [
    ("restaurants", "Рестораны и кафе", "🍽️"),
    ("coffee-tea", "Кофейни, чай и сладкое", "☕"),
    ("bars-nightlife", "Бары и ночная жизнь", "🍸"),
    ("gastro", "Гастро-опыт и дегустации", "🧀"),
    ("parks-walks", "Парки, прогулки и виды", "🌳"),
    ("sights", "Достопримечательности и архитектура", "🏛️"),
    ("museums-tours", "Музеи, выставки, экскурсии", "🖼️"),
    ("stage-music", "Музыка, сцена и вечеринки", "🎭"),
    ("games", "Игры и интеллект", "🎲"),
    ("creative", "Творчество и мастер-классы", "🎨"),
    ("sport-try", "Спорт: попробовать", "🧗"),
    ("sport-watch", "Спорт: смотреть", "🏟️"),
    ("extreme", "Экстрим и адреналин", "⚡"),
    ("speed", "Скорость и техника", "🏎️"),
    ("water", "Вода", "🌊"),
    ("sky", "Небо", "🪂"),
    ("relax", "Релакс и тело", "🧖"),
    ("nature-animals", "Природа и животные", "🦌"),
    ("out-of-town", "За городом и поездки", "🏡"),
    ("kids", "Дети и семья", "🎠"),
]
CAT_ID = {name: cid for cid, name, _ in CATEGORIES}
SEASON = {"круглый год": "all", "тепло": "warm", "лето": "summer", "зима": "winter"}
SETTING = {"в помещении": "indoor", "на улице": "outdoor", "и так, и так": "both"}
TR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
              ["a","b","v","g","d","e","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","h","ts","ch","sh","sch","","y","","e","yu","ya"]))

def slug(text):
    s = "".join(TR.get(ch, ch) for ch in text.lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80].strip("-")

def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def arr(items):
    return "array[" + ",".join(q(x) for x in items) + "]::text[]" if items else "'{}'::text[]"

# Типы из Guide-App → наш справочник; «Достопримечательность» там тестовая, не переносим.
GUIDE_TYPE = {
    "Верёвочный парк": "Верёвочный парк",
    "Картинг": "Картинг",
    "Парк развлечений детский": "Детский парк развлечений",
    "Скалолазание": "Скалолазание",
    "Флоатинг": "Флоатинг",
    "Клуб Игра «Мафия»": "Мафия",
    "Сайкл": "Сайкл",
    "Боулинг": "Боулинг",
    "Гоночный симулятор": "Гоночный симулятор",
    "Пляжный волейбол": "Пляжный волейбол в зале",
    "Комната антистресс": "Комната ярости (разгром)",
    "Прятки в темноте": "Прятки в темноте",
    "Сигарная комната": "Сигарный клуб",
    "Иммерсивный театр": "Иммерсивный театр",
    "Джаз-клуб": "Джаз-клуб",
    "Музей автомобилей": "Музей автомобилей и техники",
    "Искусственная волна": "Сёрфинг на искусственной волне",
    "Школа фехтования": "Фехтование",
    "Метание ножей": "Метание ножей и топоров",
    "Падел теннис": "Падел",
}

ids, by_name = set(), {}
for t in types:
    tid = slug(t["name"])
    assert tid and tid not in ids, (tid, t["name"])
    ids.add(tid)
    by_name[t["name"]] = tid
for ours in GUIDE_TYPE.values():
    assert ours in by_name, ours

descr = {}
for gt in guide["place_types"]:
    ours = GUIDE_TYPE.get(gt["name"])
    if ours and gt.get("description"):
        descr[by_name[ours]] = gt["description"].strip()[:2000]

out = ["begin;", "",
       "-- Сгенерировано data/activities/build_seed.py — правьте справочник там, не здесь.", ""]
out.append("insert into public.activity_categories (id, name, emoji, sort) values")
out.append(",\n".join(f"  ({q(c)}, {q(n)}, {q(e)}, {i})" for i, (c, n, e) in enumerate(CATEGORIES)))
out.append("on conflict (id) do update set name = excluded.name, emoji = excluded.emoji, sort = excluded.sort;")
out.append("")
rows = []
for i, t in enumerate(types):
    tid = by_name[t["name"]]
    rows.append("  (" + ", ".join([
        q(tid), q(CAT_ID[t["category"]]), q(t["name"]), q(t["emoji"]), q(descr.get(tid)),
        q(t["activity"]), q(t["emotion"]), q(t["price_level"]), q(t["duration_h"]),
        q(SEASON[t["season"]]), q(SETTING[t["indoor_outdoor"]]), q(t["min_people"]),
        q(t["kids"]), q(t["search_query"] or None), q(t["geo"]), q(i),
    ]) + ")")
out.append("insert into public.activity_types (id, category_id, name, emoji, description, activity_level, "
           "emotion_level, price_level, duration_hours, season, setting, min_people, kids_ok, search_query, geo, sort) values")
out.append(",\n".join(rows))
out.append("on conflict (id) do update set category_id = excluded.category_id, name = excluded.name, "
           "emoji = excluded.emoji, description = coalesce(excluded.description, public.activity_types.description), "
           "activity_level = excluded.activity_level, emotion_level = excluded.emotion_level, "
           "price_level = excluded.price_level, duration_hours = excluded.duration_hours, season = excluded.season, "
           "setting = excluded.setting, min_people = excluded.min_people, kids_ok = excluded.kids_ok, "
           "search_query = excluded.search_query, geo = excluded.geo, sort = excluded.sort, updated_at = now();")
out.append("")

prow, links = [], []
for p in guide["places"]:
    ours = GUIDE_TYPE.get(p["place_type"])
    if not ours:
        continue
    photos = [x.strip('"') for x in (p.get("photos") or "{}").strip("{}").split(",") if x.strip('"')]
    city = p["city"] if p["city"] and p["city"] != "Не указан" else None
    price = int(float(p["price_from"])) if p.get("price_from") not in (None, "") else None
    prow.append("  (" + ", ".join([
        q(p["id"]), q(p["name"].strip()[:300]), q(city), q(p["address"]), q(p["lat"]), q(p["lon"]),
        q((p.get("description") or None) and p["description"][:4000]), q(photos[0] if photos else None), arr(photos),
        q(p.get("hours")), q(price), q("guide-app"), q(p["id"]),
    ]) + ")")
    links.append(f"  ({q(p['id'])}, {q(by_name[ours])}, true)")
out.append("insert into public.places (id, name, city, address, lat, lon, description, image_url, photos, hours, "
           "price_from, source, source_id) values")
out.append(",\n".join(prow))
out.append("on conflict (source, source_id) do nothing;")
out.append("")
out.append("insert into public.place_activity_types (place_id, activity_type_id, is_primary) values")
out.append(",\n".join(links))
out.append("on conflict do nothing;")
out += ["", "commit;", ""]
dest = ROOT / "supabase/migrations/041_activity_catalog_seed.sql"
dest.write_text("\n".join(out), encoding="utf-8")
print(f"{len(CATEGORIES)} categories, {len(types)} types, {len(prow)} places → {dest.name}")
