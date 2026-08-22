import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { getPressTransition } from "../../motion";
import { AssistantIcon, CloseIcon, SendIcon } from "./icons";
import { AssistantMessage, type ChatMessage } from "./message";

type ConnectionState = "idle" | "connecting" | "ready" | "error";

type AssistantDrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreateTrainingEvent: (
    type: DisasterType,
  ) => Promise<PlatformEvent>;
};

export function AssistantDrawer({
  open,
  onOpenChange,
  onCreateTrainingEvent,
}: AssistantDrawerProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  /** Text arriving token by token, before it becomes a settled message. */
  const [streamingText, setStreamingText] = useState("");
  /** Which upstream tool the model is running, so the wait is explained. */
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const connectionStartedRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(open);
  const transcriptUpdate = `${messages.length + 1}-${sending}`;
  const suggestions = [
    t("assistant.suggestWildfire"),
    t("assistant.suggestHealth"),
    t("assistant.suggestRain"),
  ];
  const welcomeMessage: ChatMessage = {
    id: "welcome",
    role: "assistant",
    text: t("assistant.welcome"),
  };

  useEffect(() => {
    if (!open || connectionStartedRef.current) return;
    connectionStartedRef.current = true;
    setConnection("connecting");
    void import("../../mcp-client")
      .then(({ connectMcp }) => connectMcp())
      .then(() => {
        setConnection("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          connectionStartedRef.current = false;
          setConnection("error");
          return;
        }
        throw error;
      });
  }, [open]);

  useEffect(() => {
    if (open && connection === "ready") {
      inputRef.current?.focus();
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [connection, open]);

  useEffect(() => {
    if (!open || transcriptUpdate === "0-false") return;
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [open, reduceMotion, transcriptUpdate]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const submitQuery = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || sending) return;
    const normalizedQuery = query.toLocaleLowerCase();
    const trainingTypes = [
      ["wildfire", ["wildfire", "forest fire", "산불"]],
      ["rain", ["heavy rain", "rainstorm", "호우", "폭우"]],
      ["flood", ["flood", "inundation", "홍수", "침수"]],
      ["landslide", ["landslide", "산사태"]],
      ["heatwave", ["heatwave", "heat wave", "폭염"]],
      ["earthquake", ["earthquake", "지진"]],
    ] satisfies readonly (readonly [DisasterType, readonly string[]])[];
    const isTrainingRequest = ["training", "훈련", "연습"].some((term) =>
      normalizedQuery.includes(term),
    );
    const requestedTrainingType = isTrainingRequest
      ? trainingTypes.find(([, terms]) =>
          terms.some((term) => normalizedQuery.includes(term)),
        )?.[0]
      : undefined;
    if (!requestedTrainingType && connection !== "ready") return;
    setInput("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: query },
    ]);
    try {
      if (requestedTrainingType) {
        const event = await onCreateTrainingEvent(requestedTrainingType);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: t("assistant.trainingSync", { headline: event.headline }),
          },
        ]);
        return;
      }
      const { assistantStatus, streamChat } = await import(
        "../../assistant-chat"
      );
      const status = await assistantStatus();
      if (status.configured) {
        // The model reasons before it answers, so the text is streamed: a
        // blank panel for eight seconds reads as broken, a sentence forming
        // reads as thinking.
        await new Promise<void>((resolve) => {
          let text = "";
          const history = [
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.text,
            })),
            { role: "user" as const, content: query },
          ];
          abortRef.current = streamChat(history, (event) => {
            if (event.kind === "tool") setRunningTool(event.name);
            if (event.kind === "notice" || event.kind === "error") {
              text += (text ? "\n\n" : "") + event.text;
              setStreamingText(text);
            }
            if (event.kind === "delta") {
              text += event.text;
              setStreamingText(text);
            }
            if (event.kind === "done") {
              setRunningTool(null);
              setStreamingText("");
              if (text.trim()) {
                setMessages((current) => [
                  ...current,
                  { id: crypto.randomUUID(), role: "assistant", text },
                ]);
              }
              resolve();
            }
          });
        });
        return;
      }
      // No model configured: the read-only query path still answers from the
      // platform's own data rather than leaving the question unanswered.
      const { answerAssistantQuery } = await import("../../assistant-query");
      const answer = await answerAssistantQuery(query);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: answer.text,
          answer,
        },
      ]);
    } catch (error) {
      if (error instanceof Error) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: t("assistant.loadError"),
          },
        ]);
      } else {
        throw error;
      }
    } finally {
      setSending(false);
      setRunningTool(null);
      setStreamingText("");
      abortRef.current = null;
    }
  };

  // Closing the panel mid-answer stops the work rather than leaving it
  // streaming into a component nobody is looking at.
  useEffect(() => {
    if (open) return;
    abortRef.current?.();
    abortRef.current = null;
  }, [open]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            className="assistant-drawer"
            aria-label={t("assistant.label")}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
          >
            <header className="assistant-header">
              <h2>{t("assistant.title")}</h2>
              <motion.button
                className="assistant-icon-button"
                type="button"
                aria-label={t("assistant.close")}
                onClick={() => onOpenChange(false)}
                whileTap={reduceMotion ? {} : { scale: 0.94 }}
                transition={getPressTransition(reduceMotion)}
              >
                <CloseIcon />
              </motion.button>
            </header>

            <div
              className="assistant-transcript"
              ref={transcriptRef}
              aria-live="polite"
            >
              {connection === "error" ? (
                <p className="assistant-connection-error" role="alert">
                  {t("assistant.connectionError")}
                </p>
              ) : null}
              <AssistantMessage message={welcomeMessage} />
              {messages.map((message) => (
                <AssistantMessage key={message.id} message={message} />
              ))}
              {streamingText ? (
                <div className="assistant-stream" aria-live="polite">
                  {/* The gradient sweeps only over the last few characters,
                      so it marks where the text is growing rather than
                      animating the whole answer forever. */}
                  <p>
                    {streamingText.slice(0, -12)}
                    <em>{streamingText.slice(-12)}</em>
                  </p>
                </div>
              ) : null}
              {sending && !streamingText ? (
                <div className="assistant-pending" role="status">
                  <i />
                  {runningTool
                    ? t("assistant.runningTool", { tool: runningTool })
                    : t("assistant.checking")}
                </div>
              ) : null}
              {messages.length === 0 ? (
                <div className="assistant-suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      disabled={sending}
                      onClick={() => void submitQuery(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <form
              className="assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitQuery(input);
              }}
            >
              <label htmlFor="assistant-input">{t("assistant.askLabel")}</label>
              <div>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  value={input}
                  rows={2}
                  maxLength={500}
                  placeholder={t("assistant.placeholder")}
                  disabled={sending}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitQuery(input);
                    }
                  }}
                />
                <motion.button
                  type="submit"
                  aria-label={t("assistant.send")}
                  disabled={!input.trim() || sending}
                  whileTap={reduceMotion ? {} : { scale: 0.94 }}
                  transition={getPressTransition(reduceMotion)}
                >
                  <SendIcon />
                </motion.button>
              </div>
              <small>{t("assistant.evidence")}</small>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>

      {!open ? (
        <motion.button
          ref={launcherRef}
          className="assistant-launcher"
          type="button"
          aria-label={t("assistant.open")}
          onClick={() => onOpenChange(true)}
          whileTap={reduceMotion ? {} : { scale: 0.95 }}
          transition={getPressTransition(reduceMotion)}
        >
          <AssistantIcon />
          <span>{t("assistant.ask")}</span>
        </motion.button>
      ) : null}
    </>
  );
}
