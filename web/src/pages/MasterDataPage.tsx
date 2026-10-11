import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useSession } from "../api/session";
import {
  MASTER_COLLECTION_META,
  masterCollectionPath,
  masterCollectionsForRole,
} from "./masterDataAccess";
import { QualificationsScreen } from "./masterData/QualificationsScreen";
import { SimpleResourceScreen } from "./masterData/SimpleResourceScreen";

export function MasterDataPage() {
  const session = useSession();
  if (!session) return null;
  const allowed = masterCollectionsForRole(session.user.role);
  if (allowed.length === 0) return null;
  const first = allowed[0];
  if (!first) return null;

  return (
    <>
      <nav aria-label="Master data">
        <ul className="master-subnav">
          {allowed.map((collection) => (
            <li key={collection}>
              <NavLink to={masterCollectionPath(collection)} end>
                {MASTER_COLLECTION_META[collection].title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Navigate to={masterCollectionPath(first)} replace />} />
        <Route path="awarding-bodies" element={<SimpleResourceScreen collection="awarding-bodies" />} />
        <Route path="training-partners" element={<SimpleResourceScreen collection="training-partners" />} />
        <Route path="centres" element={<SimpleResourceScreen collection="centres" />} />
        <Route path="qualifications" element={<QualificationsScreen />} />
        <Route path="learners" element={<SimpleResourceScreen collection="learners" />} />
        <Route
          path="*"
          element={
            <>
              <h1>Master data</h1>
              <p role="status">This list is not available.</p>
            </>
          }
        />
      </Routes>
    </>
  );
}
