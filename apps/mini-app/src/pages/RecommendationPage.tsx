import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import type { RecommendationOutcome } from "../types";
import { Button, Card, ErrorState, LoadingState, useAsyncData } from "../components/ui";
import { useI18n } from "../i18n";

export function RecommendationPage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const { data, loading, error, reload } = useAsyncData(
    () => api.recommendation(id),
    [api, id],
    undefined,
    { live: true },
  );
  const [feedback, setFeedback] = useState<Record<number, RecommendationOutcome>>({});
  const [feedbackError, setFeedbackError] = useState("");
  if (loading) return <LoadingState label={t("recs.loadingOne")} />;
  if (error || !data)
    return <ErrorState message={error ?? t("recs.missing")} retry={reload} />;
  return (
    <>
      <Link className="back-link" to="/recommendations">
        {t("recs.back")}
      </Link>
      <header className="my-5">
        <div className="idea-icon mb-4">✦</div>
        <p className="eyebrow">{t("recsPage.recommendation")}</p>
        <h1 className="text-2xl font-bold leading-tight tracking-tight">{data.query}</h1>
        {data.created_at && (
          <p className="mt-2 text-sm text-muted">{formatDate(data.created_at)}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {data.person && (
            <Link className="tag tag-link" to={`/people/${data.person.id}`}>
              ◉ {data.person.name}
            </Link>
          )}
          {data.space && (
            <Link className="tag tag-link" to={`/spaces/${data.space.id}`}>
              ◇ {data.space.name}
            </Link>
          )}
          {data.task && (
            <Link className="tag tag-link" to="/tasks">
              ✓ {data.task.title}
            </Link>
          )}
        </div>
      </header>
      <ol className="space-y-3">
        {data.items.map((item, index) => {
          const link = item.url ?? item.link;
          return (
            <li key={`${item.title}-${index}`}>
              <Card>
                <div className="flex gap-3">
                  <span className="idea-number">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold">{item.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{item.rationale}</p>
                    {(item.provenance?.length || item.experience_ids?.length) && (
                      <div className="mt-3">
                        <p className="text-xs font-bold text-muted">{t("recs.why")}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.provenance?.map((source, sourceIndex) =>
                            source.type === "experience" && source.id ? (
                              <Link
                                className="tag tag-link"
                                key={`${source.type}-${source.id}`}
                                to={`/experiences/${source.id}`}
                              >
                                ◌ {source.label || source.detail || t("recs.experience")}
                              </Link>
                            ) : (
                              <span
                                className="tag"
                                key={`${source.type}-${source.id ?? sourceIndex}`}
                              >
                                {source.label || source.detail || source.type}
                              </span>
                            ),
                          )}
                          {item.experience_ids?.map((experienceId) => (
                            <Link
                              className="tag tag-link"
                              key={experienceId}
                              to={`/experiences/${experienceId}`}
                            >
                              ◌ {t("recs.pastExperience")}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {link && (
                      <a
                        className="mt-3 inline-flex text-sm font-semibold text-accent underline-offset-4 hover:underline"
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("recs.openLink")}
                      </a>
                    )}
                    <div
                      className="mt-4 flex flex-wrap gap-2"
                      aria-label={t("recsPage.feedbackFor", { title: item.title })}
                    >
                      {(
                        [
                          ["liked", t("recs.helpful")],
                          ["disliked", t("recs.notForMe")],
                          ["used", t("recs.usedIt")],
                        ] as const
                      ).map(([outcome, label]) => (
                        <Button
                          key={outcome}
                          variant={feedback[index] === outcome ? "primary" : "secondary"}
                          className="!min-h-9 !px-3 !py-1 text-xs"
                          disabled={Boolean(feedback[index])}
                          onClick={async () => {
                            setFeedbackError("");
                            try {
                              await api.sendRecommendationFeedback(data.id, index, outcome);
                              setFeedback((current) => ({ ...current, [index]: outcome }));
                            } catch (cause) {
                              setFeedbackError(
                                cause instanceof Error ? cause.message : t("recs.feedbackFailed"),
                              );
                            }
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      {feedbackError && (
        <p className="error-text mt-3" role="alert">
          {feedbackError}
        </p>
      )}
    </>
  );
}
