import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";

export function RecommendationsPage() {
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const { data, loading, error, reload } = useAsyncData(() => api.recommendations(), [api], undefined, {
    live: true,
  });
  return (
    <>
      <Link className="back-link" to="/">
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={t("recs.eyebrow")}
        title={t("recs.title")}
        description={t("recs.description")}
      />
      {loading ? (
        <LoadingState label={t("recs.loading")} />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : !data?.length ? (
        <EmptyState icon="✦" title={t("recs.empty")} description={t("recs.emptyText")} />
      ) : (
        <div className="list-stack">
          {data.map((recommendation) => (
            <Link
              key={recommendation.id}
              to={`/recommendations/${recommendation.id}`}
              className="list-row"
            >
              <Card>
                <div className="flex items-start gap-3">
                  <span className="idea-icon">✦</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug">{recommendation.query}</h2>
                    <p className="mt-2 text-sm text-muted">
                      {recommendation.items.length}{" "}
                      {recommendation.items.length === 1 ? t("recs.idea") : t("recs.ideas")}
                      {recommendation.person
                        ? t("recs.forPerson", { name: recommendation.person.name })
                        : ""}
                    </p>
                    {recommendation.created_at && (
                      <p className="mt-3 text-xs text-muted">
                        {formatDate(recommendation.created_at)}
                      </p>
                    )}
                  </div>
                  <span className="text-muted">›</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
