import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { SITE_NAME } from "./util";
import "./site.css";

export const SITE_NAV = [
  { to: "/site", label: "Home", end: true },
  { to: "/site/team", label: "Team" },
  { to: "/site/organogram", label: "Organogram" },
  { to: "/site/people", label: "Assessors and proctors" },
  { to: "/site/sample-papers", label: "Sample papers" },
  { to: "/site/industry-linkages", label: "Industry linkages" },
  { to: "/site/grievance", label: "Grievance" },
  { to: "/site/posh", label: "POSH" },
  { to: "/site/office-documents", label: "Office documents" },
  { to: "/site/events", label: "Events calendar" },
] as const;

export function SiteLayout() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // After moving to another page, put the reader at the start of the new content.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [location.pathname]);

  return (
    <div className="site">
      <a className="skip-link" href="#site-main">
        Skip to main content
      </a>
      <header className="site-header">
        <p className="site-brand">
          <Link to="/site">{SITE_NAME}</Link>
        </p>
        <nav aria-label="Public site">
          <ul className="site-nav">
            {SITE_NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={"end" in item ? item.end : false}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="site-main" ref={main} tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          {SITE_NAME} public information. <Link to="/login">Staff sign in</Link>
        </p>
      </footer>
    </div>
  );
}
