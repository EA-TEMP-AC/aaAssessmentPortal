import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AssessorsScreen } from "./registry/AssessorsScreen";
import { ProctorsScreen } from "./registry/ProctorsScreen";
import { QualificationsScreen } from "./masterData/QualificationsScreen";
import { SimpleResourceScreen } from "./masterData/SimpleResourceScreen";

/** One place to add and edit every kind of master record. Reuses the existing list and add screens. */
export const MASTER_ENTRY_TABS = [
  { path: "awarding-bodies", label: "Awarding bodies" },
  { path: "training-partners", label: "Training partners" },
  { path: "centres", label: "Training centres" },
  { path: "assessors", label: "Assessors" },
  { path: "proctors", label: "Proctors" },
  { path: "learners", label: "Students" },
  { path: "qualifications", label: "Qualifications" },
] as const;

export function MasterEntryPage() {
  return (
    <>
      <h1>Master entry</h1>
      <nav aria-label="Master entry">
        <ul className="master-subnav">
          {MASTER_ENTRY_TABS.map((tab) => (
            <li key={tab.path}>
              <NavLink to={`/master-entry/${tab.path}`} end>
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route
          index
          element={<Navigate to="/master-entry/awarding-bodies" replace />}
        />
        <Route
          path="awarding-bodies"
          element={<SimpleResourceScreen collection="awarding-bodies" />}
        />
        <Route
          path="training-partners"
          element={<SimpleResourceScreen collection="training-partners" />}
        />
        <Route
          path="centres"
          element={<SimpleResourceScreen collection="centres" />}
        />
        <Route path="assessors" element={<AssessorsScreen />} />
        <Route path="proctors" element={<ProctorsScreen />} />
        <Route
          path="learners"
          element={<SimpleResourceScreen collection="learners" />}
        />
        <Route path="qualifications" element={<QualificationsScreen />} />
        <Route
          path="*"
          element={<p role="status">This section is not available.</p>}
        />
      </Routes>
    </>
  );
}
