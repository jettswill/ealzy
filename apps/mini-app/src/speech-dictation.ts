import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceError = "unsupported" | "permission" | "unavailable" | "failed";

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}

interface SpeechErrorEvent {
  error?: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const view = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return view.SpeechRecognition ?? view.webkitSpeechRecognition ?? null;
}

export function joinDictation(base: string, spoken: string) {
  const spokenText = spoken.replace(/\s+/g, " ").trim();
  if (!spokenText) return base;
  if (!base.trim()) return spokenText;
  const trimmed = base.replace(/\s+$/, "");
  if (/^[.,!?;:…]/.test(spokenText)) return `${trimmed}${spokenText}`;
  return `${trimmed} ${spokenText}`;
}

function transcriptsOf(results: SpeechResultList, from = 0) {
  let finals = "";
  let interim = "";
  for (let index = from; index < results.length; index += 1) {
    const result = results[index];
    const spoken = result?.[0]?.transcript ?? "";
    if (result?.isFinal) finals += spoken;
    else interim += spoken;
  }
  return { finals, interim };
}

function voiceErrorOf(code?: string): VoiceError | null {
  if (!code || code === "aborted" || code === "no-speech") return null;
  if (code === "not-allowed" || code === "service-not-allowed") return "permission";
  if (code === "audio-capture") return "unavailable";
  return "failed";
}

export function useSpeechDictation({
  value,
  onChange,
  lang,
  enabled = true,
}: {
  value: string;
  onChange: (value: string) => void;
  lang: string;
  enabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<VoiceError | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const sessionRef = useRef<{
    recognition: BrowserSpeechRecognition;
    base: string;
    finals: string;
    want: boolean;
  } | null>(null);

  valueRef.current = value;
  onChangeRef.current = onChange;

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      setListening(false);
      return;
    }
    session.want = false;
    sessionRef.current = null;
    setListening(false);
    try {
      session.recognition.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  const start = useCallback(() => {
    setError(null);
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    if (sessionRef.current) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const session = {
      recognition,
      base: valueRef.current,
      finals: "",
      want: true,
    };
    sessionRef.current = session;

    recognition.onresult = (event) => {
      const active = sessionRef.current;
      if (active !== session) return;
      const { finals, interim } = transcriptsOf(event.results);
      active.finals = finals;
      onChangeRef.current(joinDictation(active.base, `${finals}${interim}`));
    };
    recognition.onerror = (event) => {
      const next = voiceErrorOf(event.error);
      if (next) {
        session.want = false;
        setError(next);
      }
    };
    recognition.onend = () => {
      if (sessionRef.current !== session || !session.want) {
        if (sessionRef.current === session) sessionRef.current = null;
        setListening(false);
        return;
      }
      try {
        recognition.start();
      } catch {
        sessionRef.current = null;
        setListening(false);
      }
    };

    setListening(true);
    try {
      recognition.start();
    } catch {
      sessionRef.current = null;
      setListening(false);
      setError("failed");
    }
  }, [lang]);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return {
    supported: Boolean(speechRecognitionCtor()),
    listening,
    error,
    toggle,
    stop,
  };
}
