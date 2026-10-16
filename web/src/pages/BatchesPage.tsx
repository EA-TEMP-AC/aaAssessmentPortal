import { Navigate, Route, Routes } from "react-router-dom";
import { BatchCreatePage } from "./batches/BatchCreatePage";
import { BatchDetailPage } from "./batches/BatchDetailPage";
import { BatchListPage } from "./batches/BatchListPage";
import { BatchSettingsPage } from "./batches/BatchSettingsPage";

export function BatchesPage() {
  return (
    <Routes>
      <Route index element={<BatchListPage />} />
      <Route path="new" element={<BatchCreatePage />} />
      <Route path=":id" element={<BatchDetailPage />} />
      <Route path=":id/settings" element={<BatchSettingsPage />} />
      <Route path="*" element={<Navigate to="/batches" replace />} />
    </Routes>
  );
}
