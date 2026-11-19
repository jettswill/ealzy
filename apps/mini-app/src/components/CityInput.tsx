import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import type { CitySuggestion } from "../types";

// Город — только из справочника городов России: человек печатает, мы подсказываем,
// выбрать можно лишь из списка. Выбранный город сразу запоминаем как свой.

const norm = (value: string) =>
  value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function CityInput({
  value,
  onChange,
  remember = true,
}: {
  /** Выбранный город (как в справочнике) или null. */
  value: string | null;
  onChange: (city: string | null) => void;
  /** Запоминать выбранный город как свой. */
  remember?: boolean;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const listId = useId();
  const [text, setText] = useState(value ?? "");
  const [items, setItems] = useState<CitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const request = useRef(0);

  // Город пришёл снаружи (сохранённый) — показываем его.
  useEffect(() => setText(value ?? ""), [value]);

  const search = (q: string) => {
    const id = ++request.current;
    api
      .cities(q)
      .then((found) => {
        if (id !== request.current) return;
        setItems(found);
        setActive(0);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => search(text), 140);
    return () => window.clearTimeout(timer);
    // Перезапуск — только на текст и открытие.
  }, [text, open]);

  const choose = (city: CitySuggestion) => {
    setText(city.title);
    setOpen(false);
    setHint(null);
    onChange(city.title);
    if (remember) void api.saveMyCity(city.title).catch(() => undefined);
  };

  // Ушли из поля, не выбрав: если введённое однозначно — берём, иначе просим выбрать.
  const settle = async () => {
    setOpen(false);
    const typed = text.trim();
    if (!typed) {
      setHint(null);
      onChange(null);
      return;
    }
    if (value && norm(typed) === norm(value)) return;
    try {
      // Сервер понимает и опечатки, и «спб»: что узнал — то и город (и он же запомнен).
      const saved = await api.saveMyCity(typed);
      setText(saved.city);
      setHint(null);
      onChange(saved.city);
    } catch {
      setHint(t("wheel.cityPick"));
      setText(value ?? "");
    }
  };

  return (
    <div className="city-input">
      <input
        className="input"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        value={text}
        maxLength={80}
        placeholder={t("wheel.cityPlaceholder")}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setHint(null);
        }}
        onKeyDown={(event) => {
          if (!open || !items.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(items.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const city = items[active];
            if (city) choose(city);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => window.setTimeout(() => void settle(), 120)}
      />
      {open && items.length > 0 && (
        <ul className="city-input-list" role="listbox" id={listId}>
          {items.map((city, index) => (
            <li
              key={city.title}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? "city-input-active" : undefined}
              // mousedown, а не click: иначе поле теряет фокус раньше выбора.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(city);
              }}
            >
              <span>{city.name}</span>
              {city.region && <span className="city-input-region">{city.region}</span>}
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="wheel-hint">{hint}</p>}
    </div>
  );
}
