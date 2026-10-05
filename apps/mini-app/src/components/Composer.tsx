import { useLayoutEffect, useRef, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { useSpeechDictation, type VoiceError } from "../speech-dictation";

const COMPOSER_MIN_HEIGHT = 24;
const COMPOSER_MAX_HEIGHT = 168;

function voiceMessage(t: (key: string) => string, error: VoiceError | null) {
  if (!error) return "";
  if (error === "unsupported") return t("common.voiceUnsupported");
  if (error === "permission") return t("common.voicePermission");
  if (error === "unavailable") return t("common.voiceUnavailable");
  return t("common.voiceFailed");
}

export function ComposerBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  error,
  onRetry,
  autoFocus,
  label,
  docked = true,
  inputId = "companion-message",
  allowEmpty = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  error?: string;
  onRetry?: () => void;
  autoFocus?: boolean;
  label?: string;
  docked?: boolean;
  inputId?: string;
  allowEmpty?: boolean;
}) {
  const { t, locale } = useI18n();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useSpeechDictation({
    value,
    onChange,
    lang: locale,
    enabled: !disabled,
  });
  const alert = error || voiceMessage(t, voice.error);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(Math.max(area.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`;
  }, [value]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    voice.stop();
    onSubmit();
  };

  return (
    <form
      className={`${docked ? "composer composer-dock" : "composer"}${
        voice.listening ? " composer-listening" : ""
      }`}
      onSubmit={submit}
    >
      {alert && (
        <div className="composer-alert mb-2">
          <p className="error-text" role="alert">
            {alert}
          </p>
          {onRetry && (
            <button type="button" className="chip chip-retry" disabled={disabled} onClick={onRetry}>
              {t("companion.retry")}
            </button>
          )}
        </div>
      )}
      <label className="sr-only" htmlFor={inputId}>
        {label ?? t("companion.message")}
      </label>
      <textarea
        ref={areaRef}
        id={inputId}
        className="input composer-input"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={voice.listening ? t("common.voiceListening") : placeholder}
        rows={1}
        disabled={disabled}
      />
      <div className="composer-toolbar">
        <p className="composer-hint" aria-live="polite">
          {voice.listening ? t("common.voiceListening") : ""}
        </p>
        <button
          type="button"
          className={`composer-mic${voice.listening ? " composer-mic-on" : ""}`}
          aria-label={voice.listening ? t("common.voiceStop") : t("common.voiceStart")}
          aria-pressed={voice.listening}
          disabled={disabled}
          onClick={voice.toggle}
        >
          <MicIcon listening={voice.listening} />
        </button>
        <button
          type="submit"
          className="composer-send"
          disabled={(!allowEmpty && !value.trim()) || disabled}
          aria-label={t("common.send")}
        >
          <SendIcon />
        </button>
      </div>
    </form>
  );
}

export function ComposerLaunch({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="composer composer-dock composer-launch"
      onClick={onOpen}
      aria-label={t("home.openChat")}
    >
      <span className="composer-launch-placeholder">{t("home.ask")}</span>
    </button>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg className="composer-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {listening ? (
        <>
          <rect x="4.5" y="8" width="2.4" height="8" rx="1.2" fill="currentColor" />
          <rect x="8.7" y="5.5" width="2.4" height="13" rx="1.2" fill="currentColor" />
          <rect x="12.9" y="7" width="2.4" height="10" rx="1.2" fill="currentColor" />
          <rect x="17.1" y="9" width="2.4" height="6" rx="1.2" fill="currentColor" />
        </>
      ) : (
        <>
          <rect
            x="9"
            y="3.5"
            width="6"
            height="10"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="composer-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V6.5M6.5 12 12 5.8 17.5 12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
