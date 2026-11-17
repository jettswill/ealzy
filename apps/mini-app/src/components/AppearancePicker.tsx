import { useState } from "react";
import { useI18n } from "../i18n";
import { appearanceChoice, setAppearanceChoice, type AppearanceChoice } from "../theme";

/** «Оформление»: как в системе (по умолчанию), светлая или тёмная — тот же выбор, что в iOS. */
export function AppearancePicker() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<AppearanceChoice>(appearanceChoice);
  const options: { value: AppearanceChoice; label: string }[] = [
    { value: "system", label: t("more.appearanceSystem") },
    { value: "light", label: t("more.appearanceLight") },
    { value: "dark", label: t("more.appearanceDark") },
  ];
  return (
    <section className="settings-group" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="settings-group-title">
        {t("more.appearanceTitle")}
      </h2>
      <div className="segmented" role="radiogroup" aria-labelledby="appearance-title">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={choice === option.value}
            className={`segmented-item ${choice === option.value ? "segmented-item-active" : ""}`}
            onClick={() => {
              setChoice(option.value);
              setAppearanceChoice(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
