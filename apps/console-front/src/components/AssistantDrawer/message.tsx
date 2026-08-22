import type { AssistantAnswer } from "../../assistant-query";
import { useI18n } from "../../i18n";

export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly answer?: AssistantAnswer;
};

type AssistantMessageProps = {
  readonly message: ChatMessage;
};

export function AssistantMessage({ message }: AssistantMessageProps) {
  const { t } = useI18n();

  return (
    <article className={`assistant-message is-${message.role}`}>
      <span>
        {message.role === "assistant"
          ? t("assistant.role")
          : t("assistant.you")}
      </span>
      <p>{message.text}</p>
      {message.answer?.details.length ? (
        <ul>
          {message.answer.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {message.answer?.warning ? (
        <p className="assistant-warning">{message.answer.warning}</p>
      ) : null}
      {message.answer?.citations.length ? (
        <div className="assistant-citations">
          <strong>{t("assistant.sources")}</strong>
          {message.answer.citations.map((citation) => (
            <a
              href={citation.url}
              key={`${citation.label}-${citation.url}`}
              target="_blank"
              rel="noreferrer"
            >
              <span>{citation.label}</span>
              {citation.asOf ? <small>{citation.asOf}</small> : null}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}
