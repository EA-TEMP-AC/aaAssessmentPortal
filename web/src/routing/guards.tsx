import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "../api/client";
import { useSession } from "../api/session";
import type { Role } from "./access";

export function AuthBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true });
    });
  }, [navigate]);

  return null;
}

export function RootRedirect() {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to="/home" replace />;
}

export function GuestOnly() {
  const session = useSession();
  if (!session) return <Outlet />;
  if (session.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to="/home" replace />;
}

export function RequireAuth() {
  const session = useSession();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace />;

  const onGate = location.pathname === "/change-password";
  if (session.user.mustChangePassword && !onGate) {
    return <Navigate to="/change-password" replace />;
  }
  if (!session.user.mustChangePassword && onGate) {
    return <Navigate to="/home" replace />;
  }
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (!roles.includes(session.user.role)) return <Navigate to="/home" replace />;
  return <Outlet />;
}
