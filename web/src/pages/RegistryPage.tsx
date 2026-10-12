import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useSession } from "../api/session";
import { canReadAssessors, canReadProctors } from "../routing/access";
import { AssessorsScreen } from "./registry/AssessorsScreen";
import { ProctorsScreen } from "./registry/ProctorsScreen";

export function RegistryPage() {
  const session = useSession();
  if (!session) return null;

  const showAssessors = canReadAssessors(session.user.role);
  const showProctors = canReadProctors(session.user.role);

  if (!showAssessors && !showProctors) {
    return (
      <>
        <h1>Registry</h1>
        <p role="status">You do not have permission to view the registry.</p>
      </>
    );
  }

  const defaultPath = showAssessors ? "/registry/assessors" : "/registry/proctors";

  return (
    <>
      <nav aria-label="Registry">
        <ul className="master-subnav">
          {showAssessors && (
            <li>
              <NavLink to="/registry/assessors" end>
                Assessors
              </NavLink>
            </li>
          )}
          {showProctors && (
            <li>
              <NavLink to="/registry/proctors" end>
                Proctors
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
      <Routes>
        <Route index element={<Navigate to={defaultPath} replace />} />
        {showAssessors && <Route path="assessors" element={<AssessorsScreen />} />}
        {showProctors && <Route path="proctors" element={<ProctorsScreen />} />}
        <Route
          path="*"
          element={
            <>
              <h1>Registry</h1>
              <p role="status">This section is not available.</p>
            </>
          }
        />
      </Routes>
    </>
  );
}
