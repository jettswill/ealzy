import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

/** «Ещё» — три точки справа от крупного заголовка, как в iOS-приложении. На десктопе прячется: там есть боковая панель. */
export function MoreLink() {
  const { t } = useI18n();
  return (
    <Link to="/more" className="more-link" aria-label={t("nav.moreAria")} title={t("nav.moreAria")}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="7.9" cy="12" r="1.15" fill="currentColor" />
        <circle cx="12" cy="12" r="1.15" fill="currentColor" />
        <circle cx="16.1" cy="12" r="1.15" fill="currentColor" />
      </svg>
    </Link>
  );
}
