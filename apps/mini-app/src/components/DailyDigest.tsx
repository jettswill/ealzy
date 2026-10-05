import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Card } from "./ui";

type Digest = { kind: string; text: string; generated_at: string };

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function readDismissed() {
  try {
    return localStorage.getItem("ealzy.digest.dismissed");
  } catch {
    return null;
  }
}

function writeDismissed(value: string) {
  try {
    localStorage.setItem("ealzy.digest.dismissed", value);
  } catch {
    // Приватный режим — просто покажем карточку снова.
  }
}

/**
 * Проактивный канал у Ealzy один — Telegram. Человек, зашедший с сайта, не
 * получал от продукта вообще ничего: вместо ритуалов он видел молчащий список
 * дел. Пока пуша для веба нет, сводка встречает его на входе.
 *
 * `enabled` — тот же переключатель «Утренняя сводка» из профиля: выключил там —
 * карточка не возвращается.
 */
export function DailyDigest({
  telegramLinked,
  enabled = true,
}: {
  telegramLinked: boolean;
  enabled?: boolean;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed() === dayKey(new Date()));

  useEffect(() => {
    if (telegramLinked || dismissed || !enabled) return;
    let active = true;
    void api
      .dailyDigest()
      .then((value) => {
        if (active) setDigest(value);
      })
      .catch(() => {
        // Нет сводки — экран просто остаётся без карточки.
      });
    return () => {
      active = false;
    };
  }, [api, telegramLinked, dismissed, enabled]);

  if (telegramLinked || dismissed || !enabled || !digest?.text.trim()) return null;

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{t("home.digestEyebrow")}</p>
        <button
          type="button"
          className="back-link"
          onClick={() => {
            writeDismissed(dayKey(new Date()));
            setDismissed(true);
          }}
        >
          {t("home.digestHide")}
        </button>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{digest.text}</p>
      <p className="mt-3 text-xs text-muted">{t("home.digestTelegramHint")}</p>
    </Card>
  );
}
