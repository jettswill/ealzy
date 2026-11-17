import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { Button, Card, Field, LoadingState, PageHeader } from "../components/ui";
import type { AdminQuota, AdminUserQuota, QuotaPlan } from "../types";

const number = new Intl.NumberFormat("ru-RU");

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : "Не получилось";
}

/** Лимиты облачной Илзи: тарифы, общий выключатель и тариф конкретного человека. */
export function AdminPage() {
  const { api } = useAuth();
  const [data, setData] = useState<AdminQuota | null>(null);
  const [plans, setPlans] = useState<QuotaPlan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = (next: AdminQuota) => {
    setData(next);
    setPlans(next.plans ?? []);
  };

  useEffect(() => {
    api.adminQuota().then(apply, (cause) => setError(errorText(cause)));
  }, [api]);

  if (!data && !error) return <LoadingState />;

  if (data && !data.is_admin) {
    return (
      <>
        <PageHeader title="Админка" description="Лимиты облачной Илзи и тарифы." />
        <Card>
          <p className="text-sm text-muted">
            Администратор ещё не назначен — можно стать им одной кнопкой. После этого других
            администраторов не будет.
          </p>
          {error && <p className="error-text mt-3">{error}</p>}
          <Button
            className="mt-4"
            onClick={() => api.adminClaim().then(apply, (cause) => setError(errorText(cause)))}
          >
            Стать администратором
          </Button>
        </Card>
      </>
    );
  }

  const update = (plan: string, patch: Partial<QuotaPlan>) =>
    setPlans((rows) => rows.map((row) => (row.plan === plan ? { ...row, ...patch } : row)));

  const save = async (enforced?: boolean) => {
    setError("");
    setNotice("");
    try {
      apply(
        await api.adminSaveQuota({
          enforced,
          plans: plans.map(({ plan, period, period_tokens, window_hours, window_tokens }) => ({
            plan,
            period,
            period_tokens,
            window_hours,
            window_tokens,
          })),
        }),
      );
      setNotice("Сохранено");
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <>
      <PageHeader title="Админка" description="Лимиты облачной Илзи и тарифы." />
      <Card>
        <h2 className="font-semibold">Лимиты {data?.enforced ? "включены" : "выключены"}</h2>
        <p className="mt-1 text-sm text-muted">
          {data?.enforced
            ? "Когда лимит кончается, облачная Илзи отдыхает; в iOS можно продолжать на модели в iPhone."
            : "Токены считаются, но никого не останавливаем."}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => void save(!data?.enforced)}>
          {data?.enforced ? "Выключить лимиты" : "Включить лимиты"}
        </Button>
      </Card>

      {plans.map((plan) => (
        <Card key={plan.plan} className="mt-4">
          <h2 className="font-semibold">
            {plan.title} <span className="text-sm text-muted">· {plan.plan}</span>
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Период">
              <select
                className="input"
                value={plan.period}
                onChange={(e) => update(plan.plan, { period: e.target.value as "week" | "month" })}
              >
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
              </select>
            </Field>
            <Field label="Токенов за период" hint="0 — без лимита">
              <input
                className="input"
                type="number"
                min={0}
                value={plan.period_tokens}
                onChange={(e) => update(plan.plan, { period_tokens: Number(e.target.value) })}
              />
            </Field>
            <Field label="Окно, часов" hint="Чтобы не выбрать всё за раз">
              <input
                className="input"
                type="number"
                min={1}
                max={168}
                value={plan.window_hours}
                onChange={(e) => update(plan.plan, { window_hours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Токенов за окно" hint="0 — без лимита">
              <input
                className="input"
                type="number"
                min={0}
                value={plan.window_tokens}
                onChange={(e) => update(plan.plan, { window_tokens: Number(e.target.value) })}
              />
            </Field>
          </div>
        </Card>
      ))}

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()}>Сохранить лимиты</Button>
        {notice && <span className="text-sm text-accent">{notice}</span>}
      </div>
      {error && <p className="error-text mt-3">{error}</p>}

      <UserPlanCard plans={plans} />
    </>
  );
}

function UserPlanCard({ plans }: { plans: QuotaPlan[] }) {
  const { api } = useAuth();
  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<AdminUserQuota | null>(null);
  const [plan, setPlan] = useState("pro");
  const [until, setUntil] = useState("");
  const [error, setError] = useState("");

  const find = async () => {
    setError("");
    try {
      const result = await api.adminUserQuota(handle.trim());
      setFound(result);
      setPlan(result.quota.plan);
    } catch (cause) {
      setFound(null);
      setError(errorText(cause));
    }
  };

  const assign = async () => {
    setError("");
    try {
      setFound(
        await api.adminSetUserPlan(
          handle.trim(),
          plan,
          until ? new Date(`${until}T23:59:59`).toISOString() : null,
        ),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <Card className="mt-8">
      <h2 className="font-semibold">Тариф человека</h2>
      <p className="mt-1 text-sm text-muted">@username из Telegram, почта, Telegram ID или id.</p>
      <div className="mt-3 flex gap-2">
        <input
          className="input"
          value={handle}
          placeholder="@username"
          onChange={(e) => setHandle(e.target.value)}
        />
        <Button variant="secondary" onClick={() => void find()} disabled={!handle.trim()}>
          Найти
        </Button>
      </div>
      {found && (
        <div className="mt-4 text-sm">
          <p className="font-semibold">
            {found.user.name} {found.user.username ? `· @${found.user.username}` : ""}
          </p>
          <p className="mt-1 text-muted">
            {found.quota.plan_title}
            {found.quota.plan_until
              ? ` до ${new Date(found.quota.plan_until).toLocaleDateString("ru-RU")}`
              : ""}{" "}
            · за {found.quota.period.kind === "week" ? "неделю" : "месяц"}{" "}
            {number.format(found.quota.period.used)} из{" "}
            {found.quota.period.limit ? number.format(found.quota.period.limit) : "∞"} токенов
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Тариф">
              <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.plan} value={p.plan}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="До" hint="Пусто — бессрочно">
              <input
                className="input"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </div>
          <Button className="mt-3" onClick={() => void assign()}>
            Назначить
          </Button>
        </div>
      )}
      {error && <p className="error-text mt-3">{error}</p>}
    </Card>
  );
}
