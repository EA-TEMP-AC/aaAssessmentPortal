import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PasswordGatePage } from "./pages/PasswordGatePage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { UsersPage } from "./pages/UsersPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RoleHomePage } from "./pages/RoleHomePage";
import { AuthBridge, GuestOnly, RequireAuth, RequireRole, RootRedirect } from "./routing/guards";
import { NAV_ITEMS } from "./routing/nav";
import { createQueryClient } from "./queryClient";

export function AppRoutes() {
  const sections = NAV_ITEMS.filter((item) => item.id !== "home");

  return (
    <>
      <AuthBridge />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/change-password" element={<PasswordGatePage />} />
          <Route element={<AppLayout />}>
            <Route path="/home" element={<RoleHomePage />} />
            {sections.map((item) => (
              <Route key={item.id} element={<RequireRole roles={item.roles} />}>
                <Route
                  path={item.to}
                  element={
                    item.id === "audit" ? (
                      <AuditLogPage />
                    ) : item.id === "users" ? (
                      <UsersPage />
                    ) : (
                      <PlaceholderPage title={item.label} description={item.description} />
                    )
                  }
                />
              </Route>
            ))}
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
