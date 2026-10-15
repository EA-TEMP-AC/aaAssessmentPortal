import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout } from "../api/auth";
import { getAccessSettings } from "../api/settings";
import { setAccessSettings, useSession, useSessionAccessSettings } from "../api/session";
import { ROLE_LABELS } from "../routing/access";
import { navItemsForRole } from "../routing/nav";

export function SignOutButton() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        setPending(true);
        void logout().finally(() => {
          navigate("/login", { replace: true });
        });
      }}
    >
      Sign out
    </button>
  );
}

export function AppLayout() {
  const session = useSession();
  const isNcvetViewer = session?.user.role === "ncvet_viewer";

  const accessSettings = useSessionAccessSettings();

  // Q182: ncvet_viewer loads the access settings once the shell mounts (after sign-in or a
  // restored session) and again whenever the page regains focus. A failure hides the link.
  useEffect(() => {
    if (!isNcvetViewer) return;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      getAccessSettings(own.signal).then(
        (next) => {
          if (!own.signal.aborted) setAccessSettings(next);
        },
        () => {
          if (!own.signal.aborted) setAccessSettings(null);
        },
      );
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("focus", load);
      controller?.abort();
    };
  }, [isNcvetViewer]);

  if (!session) return null;

  const items = navItemsForRole(session.user.role, {
    ncvetViewerCanSeeAbQueue: accessSettings?.ncvetViewerCanSeeAbQueue,
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <p className="product-name">AA Assessment Portal</p>
        <p className="signed-in">
          <span className="visually-hidden">Signed in as </span>
          {session.user.name}
          <span className="role-chip">{ROLE_LABELS[session.user.role]}</span>
        </p>
        <Link to="/account/password">Change password</Link>
        <SignOutButton />
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <nav aria-label="Primary">
            <ul className="nav-list">
              {items.map((item) => (
                <li key={item.id}>
                  <NavLink to={item.to} end={item.id !== "master-data"}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main id="main" tabIndex={-1} className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
