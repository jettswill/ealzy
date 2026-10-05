import { describe, expect, it } from "vitest";
import {
  compactBirthday,
  compactDates,
  isValidCalendarDay,
  personDateLabel,
  sortPersonDates,
} from "../src/modules/assistant/dates.js";

describe("person dates", () => {
  it("sorts birthday first and formats compact fields", () => {
    const dates = sortPersonDates([
      { kind: "other", label: "Переезд", month: 1, day: 2, year: 2021 },
      { kind: "birthday", label: null, month: 3, day: 29, year: 1994 },
      { kind: "met", label: null, month: 6, day: 12, year: 2020 },
    ]);
    expect(dates.map((item) => item.kind)).toEqual(["birthday", "met", "other"]);
    expect(compactBirthday(dates)).toBe("1994-03-29");
    expect(compactDates(dates)[0]).toMatchObject({ kind: "birthday", label: "День рождения" });
    expect(personDateLabel({ kind: "wedding", label: null })).toBe("Свадьба");
    expect(isValidCalendarDay(2, 29, null)).toBe(true);
    expect(isValidCalendarDay(2, 31, 1994)).toBe(false);
  });
});
