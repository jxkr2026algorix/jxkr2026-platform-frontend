import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getPressTransition } from "../../motion";
import { AssistantIcon, CloseIcon, SendIcon } from "./icons";
import { AssistantMessage, type ChatMessage } from "./message";

type ConnectionState = "idle" | "connecting" | "ready" | "error";

type AssistantDrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

const suggestions = [
  "청송군 산사태 현재 상황",
  "데이터 상태 알려줘",
  "재난별 대응 범위",
] as const;

const initialMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "경북 공공데이터를 조회합니다. 지역과 재난 유형을 함께 물어보세요. 출처와 확인하지 못한 원천도 같이 표시합니다.",
};

export function AssistantDrawer({ open, onOpenChange }: AssistantDrawerProps) {
  const reduceMotion = useReducedMotion();
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [connectionLabel, setConnectionLabel] = useState("Public data");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    initialMessage,
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const connectionStartedRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(open);
  const transcriptUpdate = `${messages.length}-${sending}`;

  useEffect(() => {
    if (!open || connectionStartedRef.current) return;
    connectionStartedRef.current = true;
    setConnection("connecting");
    void import("../../mcp-client")
      .then(({ connectMcp }) => connectMcp())
      .then((result) => {
        setConnection("ready");
        setConnectionLabel(`${result.serverTitle} · ${result.toolCount} tools`);
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          connectionStartedRef.current = false;
          setConnection("error");
          setConnectionLabel("Data connection unavailable");
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
    if (!query || sending || connection !== "ready") return;
    setInput("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: query },
    ]);
    try {
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
            text: "공공데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          },
        ]);
      } else {
        throw error;
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            className="assistant-drawer"
            aria-label="Public data assistant"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
          >
            <header className="assistant-header">
              <div>
                <span
                  className={`assistant-status is-${connection}`}
                  role="status"
                >
                  {connectionLabel}
                </span>
                <h2>Data assistant</h2>
              </div>
              <motion.button
                className="assistant-icon-button"
                type="button"
                aria-label="Close data assistant"
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
              {messages.map((message) => (
                <AssistantMessage key={message.id} message={message} />
              ))}
              {sending ? (
                <div className="assistant-pending" role="status">
                  <i />
                  Checking public data
                </div>
              ) : null}
              {messages.length === 1 ? (
                <div className="assistant-suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      disabled={connection !== "ready"}
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
              <label htmlFor="assistant-input">Ask about Gyeongbuk data</label>
              <div>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  value={input}
                  rows={2}
                  maxLength={500}
                  placeholder="청송군 산사태 상황을 알려줘"
                  disabled={connection !== "ready"}
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
                  aria-label="Send question"
                  disabled={connection !== "ready" || !input.trim() || sending}
                  whileTap={reduceMotion ? {} : { scale: 0.94 }}
                  transition={getPressTransition(reduceMotion)}
                >
                  <SendIcon />
                </motion.button>
              </div>
              <small>
                Evidence only · Final decisions require operator review
              </small>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>

      {!open ? (
        <motion.button
          ref={launcherRef}
          className="assistant-launcher"
          type="button"
          aria-label="Open data assistant"
          onClick={() => onOpenChange(true)}
          whileTap={reduceMotion ? {} : { scale: 0.95 }}
          transition={getPressTransition(reduceMotion)}
        >
          <AssistantIcon />
          <span>Ask data</span>
        </motion.button>
      ) : null}
    </>
  );
}
