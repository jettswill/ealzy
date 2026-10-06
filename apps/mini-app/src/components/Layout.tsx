import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useDesktopNav } from "../media";
import { LoadingState } from "./ui";
import { EalzyWordmark } from "./EalzyLogo";
import { OAuthButtons, useOAuthProviders } from "./OAuthButtons";
import { TelegramLoginButton } from "./TelegramLogin";

const TaskFormModal = lazy(async () => {
  const mod = await import("./TaskForm");
  return { default: mod.TaskFormModal };
});

function isPrefixPath(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function isGoalsPath(pathname: string) {
  return isPrefixPath(pathname, "/goals");
}

function isHomePath(pathname: string) {
  return pathname === "/" || isPrefixPath(pathname, "/tasks");
}

function isCompanionPath(pathname: string) {
  return isPrefixPath(pathname, "/companion");
}

function isProfilePath(pathname: string) {
  return isPrefixPath(pathname, "/profile");
}

function isMailPath(pathname: string) {
  return isPrefixPath(pathname, "/mail");
}

function isContextPath(pathname: string) {
  return (
    !isHomePath(pathname) &&
    !isCompanionPath(pathname) &&
    !isProfilePath(pathname) &&
    !isMailPath(pathname)
  );
}

type NavEntry = { to: string; label: string; icon: NavIcon; addLabel?: string };

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isGuest } = useAuth();
  const oauthProviders = useOAuthProviders(isGuest);
  const desktop = useDesktopNav();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const start = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));
    const stop = w.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id));
    const id = start(() => {
      void import("../pages/CompanionPage");
      void import("../pages/GoalsPage");
      void import("../pages/NotesPage");
      void import("../pages/PromisesPage");
      void import("../pages/ProfilePage");
    });
    return () => stop(id);
  }, []);
  const compact = location.pathname === "/companion";
  const contextItems: NavEntry[] = [
    {
      to: "/notes",
      label: t("nav.notes"),
      icon: "notes",
      addLabel: t("nav.addTo", { section: t("nav.notes") }),
    },
    {
      to: "/goals",
      label: t("nav.goals"),
      icon: "goals",
      addLabel: t("nav.addTo", { section: t("nav.goals") }),
    },
    { to: "/plan", label: t("nav.plan"), icon: "plan" },
    {
      to: "/promises",
      label: t("nav.bearings"),
      icon: "bearings",
      addLabel: t("nav.addTo", { section: t("nav.bearings") }),
    },
    {
      to: "/people",
      label: t("nav.people"),
      icon: "people",
      addLabel: t("nav.addTo", { section: t("nav.people") }),
    },
  ];
  const profileItem: NavEntry = {
    to: "/profile",
    label: t("more.profileTitle"),
    icon: "profile",
  };
  const mobileItems: NavEntry[] = [
    { to: "/", label: t("nav.home"), icon: "today" },
    { to: "/companion", label: t("nav.ilzi"), icon: "chat" },
    { to: "/more", label: t("nav.context"), icon: "context" },
    profileItem,
  ];
  const left = desktop ? [] : mobileItems.slice(0, 2);
  const right = desktop ? [] : mobileItems.slice(2);
  const plusJoinsNeighbors =
    !desktop && (isCompanionPath(location.pathname) || isContextPath(location.pathname));
  const addButton = (
    <button
      type="button"
      className={
        desktop ? "nav-add nav-add-icon" : `nav-add${plusJoinsNeighbors ? " nav-add-join" : ""}`
      }
      aria-label={t("nav.addAria")}
      aria-haspopup="dialog"
      aria-expanded={adding}
      onPointerDown={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
      }}
      onClick={() => setAdding(true)}
    >
      <span className="nav-add-plus" aria-hidden="true" />
      {!desktop && <span className="nav-add-label">{t("nav.add")}</span>}
    </button>
  );

  return (
    <div className="app-shell">
      <nav aria-label={t("nav.main")} className="app-nav">
        <div className="nav-brand-row">
          <NavLink to="/" className="nav-brand" end>
            <EalzyWordmark className="nav-wordmark" />
          </NavLink>
        </div>
        {desktop ? (
          <>
            <div className="nav-inner">
              <div className="nav-group">
                <NavItem
                  item={{
                    to: "/",
                    label: t("nav.home"),
                    icon: "today",
                    addLabel: t("nav.addTo", { section: t("nav.home") }),
                  }}
                  pathname={location.pathname}
                  onAdd={() => navigate("/", { state: { create: true } })}
                />
              </div>
              <div className="nav-group">
                <NavItem
                  item={{ to: "/companion", label: t("nav.ilzi"), icon: "chat" }}
                  pathname={location.pathname}
                />
              </div>
              <div className="nav-group">
                <p className="nav-section-label">{t("nav.context")}</p>
                {contextItems.map((item) => (
                  <NavItem
                    key={item.to}
                    item={item}
                    pathname={location.pathname}
                    nested
                    onAdd={
                      item.addLabel
                        ? () => navigate(item.to, { state: { create: true } })
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
            <div className="nav-footer">
              <NavItem item={profileItem} pathname={location.pathname} />
            </div>
          </>
        ) : (
          <div className="nav-inner">
            {left.map((item, index) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={location.pathname}
                neighbor={index === left.length - 1}
              />
            ))}
            {addButton}
            {right.map((item, index) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={location.pathname}
                neighbor={index === 0}
              />
            ))}
          </div>
        )}
      </nav>
      <main
        className={`${compact ? "layout-main-compact" : "layout-main"} ${
          location.pathname === "/" ? "layout-main-home" : ""
        }`}
      >
        {isGuest && (
          <div className="guest-banner" role="note">
            <p>{t(oauthProviders.length ? "auth.guestBannerTextAny" : "auth.guestBannerText")}</p>
            <div className="guest-banner-actions">
              {/* Окно входа Telegram в России без VPN не открывается, поэтому
                  способы, которым VPN не нужен, стоят первыми. */}
              <OAuthButtons providers={oauthProviders} keepSession className="guest-banner-oauth" />
              <TelegramLoginButton label={t("auth.guestLinkCta")} compact />
            </div>
          </div>
        )}
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </main>
      {adding && (
        <Suspense fallback={null}>
          <TaskFormModal onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />
        </Suspense>
      )}
    </div>
  );
}

function NavItem({
  item,
  pathname,
  nested,
  neighbor,
  onAdd,
}: {
  item: NavEntry;
  pathname: string;
  nested?: boolean;
  neighbor?: boolean;
  onAdd?: () => void;
}) {
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/" || item.to === "/companion"}
      className={({ isActive }) => {
        const active = navItemActive(item.to, pathname, isActive);
        return [
          "nav-item",
          nested && "nav-item-sub",
          neighbor && "nav-item-neighbor",
          active && "nav-item-active",
        ]
          .filter(Boolean)
          .join(" ");
      }}
    >
      <NavGlyph name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );
  if (!onAdd || !item.addLabel) return link;
  return (
    <div className="nav-item-row">
      {link}
      <button
        type="button"
        className="nav-item-add"
        aria-label={item.addLabel}
        title={item.addLabel}
        onClick={onAdd}
      >
        <span className="nav-add-plus" aria-hidden="true" />
      </button>
    </div>
  );
}

function navItemActive(to: string, pathname: string, isActive: boolean) {
  if (to === "/more") return isContextPath(pathname);
  if (to === "/goals") return isGoalsPath(pathname);
  if (to === "/people") return isPrefixPath(pathname, "/people");
  if (to === "/plan") return isPrefixPath(pathname, "/plan");
  if (to === "/promises") return isPrefixPath(pathname, "/promises");
  if (to === "/profile") return isProfilePath(pathname);
  if (to === "/") return isHomePath(pathname);
  return isActive;
}

type NavIcon =
  | "today"
  | "goals"
  | "more"
  | "context"
  | "chat"
  | "people"
  | "plan"
  | "profile"
  | "bearings"
  | "notes";

function NavGlyph({ name }: { name: NavIcon }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {iconPaths[name]}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const iconPaths: Record<NavIcon, ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" {...stroke} />
      <path d="M8 3v3M16 3v3M4 10h16" {...stroke} />
      <rect x="8.5" y="13" width="3.5" height="3.5" rx="0.7" fill="currentColor" />
    </>
  ),
  notes: (
    <>
      <path d="M6 3.75h9l3 3v13.5H6z" {...stroke} />
      <path d="M15 3.75v3h3M9 11h6M9 14.5h6M9 18h4" {...stroke} />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="8" {...stroke} />
      <circle cx="12" cy="12" r="4.25" {...stroke} />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.15" fill="currentColor" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" />
      <circle cx="18" cy="12" r="1.15" fill="currentColor" />
    </>
  ),
  context: (
    <>
      <path d="M5 9.15 12 5.8l7 3.35-7 3.35z" {...stroke} />
      <path d="M5 12.55 12 15.9 19 12.55" {...stroke} />
      <path d="M5 15.45 12 18.8 19 15.45" {...stroke} />
    </>
  ),
  chat: (
    <>
      <path
        d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3H7.5A2.5 2.5 0 0 1 5 13.5z"
        {...stroke}
      />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.25" r="2.35" {...stroke} />
      <circle cx="16.25" cy="9.1" r="1.9" {...stroke} />
      <path d="M4.4 18.5c.45-3.05 2.35-4.7 4.6-4.7 2.25 0 4.15 1.65 4.6 4.7" {...stroke} />
      <path d="M13.2 18.5c.35-2.15 1.7-3.35 3.15-3.35 1.7 0 3.05 1.25 3.4 3.35" {...stroke} />
    </>
  ),
  plan: (
    <>
      <rect x="4.5" y="5" width="15" height="14.5" rx="2" {...stroke} />
      <path d="M8 9.25h8M8 12.5h8M8 15.75h5" {...stroke} />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.25" r="2.85" {...stroke} />
      <path d="M5.25 18.75c.7-3.45 3.1-5.2 6.75-5.2s6.05 1.75 6.75 5.2" {...stroke} />
    </>
  ),
  bearings: (
    <>
      <path
        d="M12 3.7l1.95 6.35L20.3 12l-6.35 1.95L12 20.3l-1.95-6.35L3.7 12l6.35-1.95z"
        {...stroke}
      />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    </>
  ),
};
