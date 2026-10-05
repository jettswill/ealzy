import { Link } from "react-router-dom";
import type { CompletenessReport } from "../types";
import { useI18n } from "../i18n";

export function ProfileCompleteness({ report }: { report: CompletenessReport }) {
  const { t } = useI18n();
  const next = report.items.find((item) => !item.done && item.id !== "portrait");
  if (!next) return null;
  return (
    <p className="completeness-next">
      {t("completeness.hint")}{" "}
      <Link to={next.href}>{t(`completeness.item.${next.id}`)}</Link>
    </p>
  );
}
