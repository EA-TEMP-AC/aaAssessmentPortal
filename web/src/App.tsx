import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PasswordGatePage } from "./pages/PasswordGatePage";
import { AbQueuePage } from "./pages/AbQueuePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { EvidencePage } from "./pages/EvidencePage";
import { MasterDataPage } from "./pages/MasterDataPage";
import { RecognitionPage } from "./pages/RecognitionPage";
import { RegistryPage } from "./pages/RegistryPage";
import { ProjectsPage, SchemesPage, SignatoriesPage } from "./pages/schemes/SchemeScreens";
import { SettingsAccessPage } from "./pages/SettingsAccessPage";
import { UsersPage } from "./pages/UsersPage";
import { WorkingDaysPage } from "./pages/WorkingDaysPage";
import { BatchesPage } from "./pages/BatchesPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RoleHomePage } from "./pages/RoleHomePage";
import { SiteLayout } from "./site/SiteLayout";
import { EventsPage } from "./site/EventsPage";
import {
  GrievancePage,
  IndustryLinkagesPage,
  OfficeDocumentsPage,
  OrganogramPage,
  PeoplePage,
  PoshPage,
  SamplePapersPage,
  SiteHomePage,
  TeamPage,
} from "./site/pages";
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
            <Route path="/account/password" element={<ChangePasswordPage />} />
            <Route path="/settings" element={<Navigate to="/settings/access" replace />} />
            {sections.map((item) => (
              <Route key={item.id} element={<RequireRole roles={item.accessRoles ?? item.roles} />}>
                <Route
                  path={
                    item.id === "master-data"
                      ? "/master-data/*"
                      : item.id === "batches"
                        ? "/batches/*"
                        : item.id === "registry"
                          ? "/registry/*"
                          : item.to
                  }
                  element={
                    item.id === "ab-queue" ? (
                      <AbQueuePage />
                    ) : item.id === "analytics" ? (
                      <AnalyticsPage />
                    ) : item.id === "audit" ? (
                      <AuditLogPage />
                    ) : item.id === "evidence" ? (
                      <EvidencePage />
                    ) : item.id === "users" ? (
                      <UsersPage />
                    ) : item.id === "registry" ? (
                      <RegistryPage />
                    ) : item.id === "master-data" ? (
                      <MasterDataPage />
                    ) : item.id === "schemes" ? (
                      <SchemesPage />
                    ) : item.id === "projects" ? (
                      <ProjectsPage />
                    ) : item.id === "signatories" ? (
                      <SignatoriesPage />
                    ) : item.id === "recognition" ? (
                      <RecognitionPage />
                    ) : item.id === "working-days" ? (
                      <WorkingDaysPage />
                    ) : item.id === "batches" ? (
                      <BatchesPage />
                    ) : item.id === "settings" ? (
                      <SettingsAccessPage />
                    ) : (
                      <PlaceholderPage title={item.label} description={item.description} />
                    )
                  }
                />
              </Route>
            ))}
          </Route>
        </Route>
        <Route path="/site" element={<SiteLayout />}>
          <Route index element={<SiteHomePage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="organogram" element={<OrganogramPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="sample-papers" element={<SamplePapersPage />} />
          <Route path="industry-linkages" element={<IndustryLinkagesPage />} />
          <Route path="grievance" element={<GrievancePage />} />
          <Route path="posh" element={<PoshPage />} />
          <Route path="office-documents" element={<OfficeDocumentsPage />} />
          <Route path="events" element={<EventsPage />} />
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
