import { Navigate, Route, Routes } from "react-router-dom";
import { PaperCreatePage } from "./PaperCreatePage";
import { PaperDetailPage } from "./PaperDetailPage";
import { PaperListPage } from "./PaperListPage";

export function PapersPage() {
  return (
    <Routes>
      <Route index element={<PaperListPage />} />
      <Route path="new" element={<PaperCreatePage />} />
      <Route path=":id" element={<PaperDetailPage />} />
      <Route path="*" element={<Navigate to="/papers" replace />} />
    </Routes>
  );
}
