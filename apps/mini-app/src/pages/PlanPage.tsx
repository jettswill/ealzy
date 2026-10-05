import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";

export function PlanPage() {
  const { api } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const state = useAsyncData(() => api.goals(), [api], undefined, { live: true });
  const items = (state.data ?? []).filter(
    (goal) => goal.status === "active" || goal.status === "paused",
  );
  return (
    <>
      <PageHeader title={t("plan.title")} description={t("plan.description")} />
      {state.loading ? (
        <LoadingState label={t("goals.loading")} />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : !items.length ? (
        <EmptyState
          icon="▦"
          title={t("plan.empty")}
          description={t("plan.emptyText")}
          action={
            <Button variant="secondary" onClick={() => navigate("/goals")}>
              {t("nav.goals")}
            </Button>
          }
        />
      ) : (
        <div className="list-stack">
          {items.map((goal) => (
            <Link key={goal.id} to={`/goals/${goal.id}`} className="list-row">
              <span className="list-row-body">
                <span className="list-row-title">{goal.title}</span>
                <span className="list-row-text list-row-text-clamp">
                  {goal.current_plan?.trim() || t("goals.planEmpty")}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
