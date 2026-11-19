"""Справочник городов России для сервера: hflabs-city.csv → apps/api/src/modules/assistant/ru-cities.data.ts.

Источник: https://github.com/hflabs/city (CC BY-SA 4.0). Запуск: python3 data/cities/build.py
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("hflabs-city.csv")
TARGET = ROOT / "apps/api/src/modules/assistant/ru-cities.data.ts"


def region_name(kind: str, region: str) -> str:
    if kind == "г":
        return ""
    if kind == "обл":
        return f"{region} область"
    if kind == "край":
        return f"{region} край"
    if kind == "Респ":
        return f"{region} Республика" if region.endswith(("ская", "цкая")) else f"Республика {region}"
    if kind == "Аобл":
        return f"{region} автономная область"
    if kind == "АО":
        return "Ханты-Мансийский АО — Югра" if region.startswith("Ханты") else f"{region} автономный округ"
    return region


def main() -> None:
    rows = list(csv.DictReader(SOURCE.open(encoding="utf-8")))
    out = []
    for r in rows:
        name = (
            r["city"]
            or r["settlement"]
            or (r["area"] if r["area_type"] == "г" else "")
            or (r["region"] if r["region_type"] == "г" else "")
        )
        out.append(
            (
                name,
                region_name(r["region_type"], r["region"]),
                round(float(r["geo_lat"]), 4),
                round(float(r["geo_lon"]), 4),
                int(float(r["population"] or 0)),
            )
        )
    out.sort(key=lambda x: -x[4])
    lines = [
        "// Города России: название, регион, широта, долгота, население.",
        "// Источник — справочник городов HFLabs (https://github.com/hflabs/city), лицензия CC BY-SA 4.0.",
        "// Сгенерировано data/cities/build.py — руками не править.",
        "export type CityRow = readonly [name: string, region: string, lat: number, lon: number, population: number];",
        "",
        "export const RU_CITIES: readonly CityRow[] = [",
    ]
    lines += ["  " + json.dumps(list(o), ensure_ascii=False) + "," for o in out]
    lines.append("];")
    TARGET.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(out)} городов → {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
