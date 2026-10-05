import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, clearSession } from "../auth";
import { Button, Card, PageHeader } from "../components/ui";
import { useI18n } from "../i18n";

export function MorePage() {
  const { t } = useI18n();
  const workspace = [
    {
      to: "/import",
      icon: "⤵",
      title: t("more.importTitle"),
      description: t("more.importText"),
    },
    {
      to: "/notes",
      icon: "▤",
      title: t("nav.notes"),
      description: t("notes.description"),
    },
    {
      to: "/goals",
      icon: "◎",
      title: t("nav.goals"),
      description: t("goals.description"),
    },
    {
      to: "/plan",
      icon: "▦",
      title: t("nav.plan"),
      description: t("plan.description"),
    },
    {
      to: "/promises",
      icon: "✧",
      title: t("nav.bearings"),
      description: t("promises.description"),
    },
    {
      to: "/people",
      icon: "◉",
      title: t("nav.people"),
      description: t("people.description"),
    },
  ];
  return (
    <>
      <PageHeader title={t("more.title")} description={t("more.description")} />
      <div className="list-stack">
        {workspace.map((section) => (
          <Link key={section.to} to={section.to} className="list-row">
            <span className="idea-icon">{section.icon}</span>
            <span className="list-row-body">
              <span className="list-row-title">{section.title}</span>
              <span className="list-row-text">{section.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <>
      <Link to="/profile" className="back-link mb-4">
        {t("more.privacyBack")}
      </Link>
      <AccountPrivacyCard className="mt-4" />
    </>
  );
}

export function AccountPrivacyCard({ className = "mt-8" }: { className?: string }) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const exportAccount = async () => {
    setError("");
    setNotice("");
    try {
      const data = await api.exportAccount();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `ealzy-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(t("more.exportDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("more.exportFailed"));
    }
  };
  return (
    <Card className={className}>
      <h1 className="font-semibold">{t("more.privacyTitle")}</h1>
      <p className="mt-1 text-sm text-muted">{t("more.privacyText")}</p>
      {notice && <p className="mt-3 text-sm text-accent">{notice}</p>}
      {error && <p className="error-text mt-3">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void exportAccount()}>
          {t("more.export")}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm(t("more.deleteConfirm"))) return;
            try {
              await api.deleteAccount();
              clearSession();
              window.location.reload();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t("more.deleteFailed"));
            }
          }}
        >
          {t("more.delete")}
        </Button>
      </div>
    </Card>
  );
}
