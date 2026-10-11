import { Navigate, Route, Routes } from "react-router-dom";
import { BatchCreatePage } from "./batches/BatchCreatePage";
import { BatchDetailPage } from "./batches/BatchDetailPage";
import { BatchListPage } from "./batches/BatchListPage";

export function BatchesPage() {
  return (
    <Routes>
      <Route index element={<BatchListPage />} />
      <Route path="new" element={<BatchCreatePage />} />
      <Route path=":id" element={<BatchDetailPage />} />
      <Route path="*" element={<Navigate to="/batches" replace />} />
    </Routes>
  );
}
