import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createStudentLogin,
  listCandidates,
  patchCandidate,
  type CandidateRecord,
  type CsvImportResponse,
} from "../../api/candidates";
import { type BatchRecord } from "../../api/batches";
import { ApiError, errorMessage } from "../../api/client";
import {
  canReadCandidates,
  canWriteCandidates,
  isBatchRosterWritable,
  type Role,
} from "../../routing/access";
import { CandidateDialog } from "./CandidateDialog";
import { CandidateImportDialog } from "./CandidateImportDialog";

type Banner = { id: number; message: string };

type FilterOption = "all" | "active" | "inactive";

type Props = {
  batch: BatchRecord;
  role: Role;
};

export function CandidateRoster({ batch, role }: Props) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterOption>("all");
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<CandidateRecord | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [notice, setNotice] = useState<Banner | null>(null);
  const [actionError, setActionError] = useState<Banner | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [loginBusyId, setLoginBusyId] = useState<string | null>(null);
  const bannerSeq = useRef(0);
  const filterId = useId();

  const canRead = canReadCandidates(role);
  const canWrite = canWriteCandidates(role);
  const writable = isBatchRosterWritable(batch.status);
  const canOverride = role === "aa_admin";

  const filterParam =
    filter === "all" ? undefined : { active: filter === "active" };

  const candidatesQuery = useQuery({
    queryKey: ["batch-candidates", batch.id, filter],
    enabled: canRead && Boolean(batch.id),
    queryFn: ({ signal }) => listCandidates(batch.id, filterParam, signal),
  });

  if (!canRead) {
    return (
      <section
        className="candidate-roster-section"
        aria-labelledby="roster-heading"
      >
        <h2 id="roster-heading">Candidate roster</h2>
        <p role="status">Candidate roster is not accessible for this role.</p>
      </section>
    );
  }

  function handleSuccess(message: string) {
    setNotice({ id: ++bannerSeq.current, message });
    setActionError(null);
    setDialogMode(null);
    setSelectedCandidate(null);
    setShowImportDialog(false);
    void queryClient.invalidateQueries({
      queryKey: ["batch-candidates", batch.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
  }

  function handleImportComplete(message: string, result: CsvImportResponse) {
    void queryClient.invalidateQueries({
      queryKey: ["batch-candidates", batch.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["batch", batch.id] });
    if (result.errors.length === 0) {
      setNotice({ id: ++bannerSeq.current, message });
      setActionError(null);
      setShowImportDialog(false);
    }
  }

  async function handleToggleActive(item: CandidateRecord) {
    if (!writable || !canWrite || deactivatingId) return;
    setDeactivatingId(item.id);
    setActionError(null);
    setNotice(null);
    try {
      await patchCandidate(batch.id, item.id, { active: !item.active });
      const msg = item.active
        ? `Candidate ${item.name} deactivated.`
        : `Candidate ${item.name} activated.`;
      handleSuccess(msg);
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError({ id: ++bannerSeq.current, message: errorMessage(err) });
      } else {
        setActionError({
          id: ++bannerSeq.current,
          message: "Failed to update candidate status. Try again.",
        });
      }
    } finally {
      setDeactivatingId(null);
    }
  }

  async function handleLogin(item: CandidateRecord, reset: boolean) {
    if (!canWrite || loginBusyId) return;
    setLoginBusyId(item.id);
    setActionError(null);
    setNotice(null);
    try {
      await createStudentLogin(batch.id, item.id, reset);
      handleSuccess(
        reset
          ? `New password made for ${item.name}.`
          : `Login created for ${item.name}.`,
      );
    } catch (err) {
      setActionError({
        id: ++bannerSeq.current,
        message:
          err instanceof ApiError
            ? errorMessage(err)
            : "Could not update the login. Try again.",
      });
    } finally {
      setLoginBusyId(null);
    }
  }

  const items = candidatesQuery.data?.items ?? [];
  const activeCount = items.filter((c) => c.active).length;
  const inactiveCount = items.filter((c) => !c.active).length;

  return (
    <section
      className="candidate-roster-section"
      aria-labelledby="roster-heading"
    >
      <h2 id="roster-heading">Candidate roster</h2>

      {!writable ? (
        <p className="field-hint" role="status">
          Candidate roster is locked. Roster writes are allowed only while the
          batch is allocated, accepted, or assessor assigned.
        </p>
      ) : null}

      {notice ? (
        <p key={notice.id} className="form-notice" role="status">
          {notice.message}
        </p>
      ) : null}

      {actionError ? (
        <p key={actionError.id} className="form-error" role="alert">
          {actionError.message}
        </p>
      ) : null}

      {candidatesQuery.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(candidatesQuery.error)}
        </p>
      ) : null}

      <div className="candidate-toolbar choice-toolbar">
        <div className="field">
          <label htmlFor={filterId}>Filter by status</label>
          <select
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value as FilterOption)}
          >
            <option value="all">All candidates</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>

        {canWrite ? (
          <div className="row-actions">
            <button
              type="button"
              disabled={!writable}
              onClick={() => {
                setActionError(null);
                setDialogMode("add");
              }}
            >
              Add candidate
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={!writable}
              onClick={() => {
                setActionError(null);
                setShowImportDialog(true);
              }}
            >
              Import CSV
            </button>
          </div>
        ) : null}
      </div>

      <p className="candidate-summary">
        {candidatesQuery.isLoading ? (
          <span>Loading candidates...</span>
        ) : (
          <span>
            Showing {items.length} candidate(s) ({activeCount} active,{" "}
            {inactiveCount} inactive).
          </span>
        )}
      </p>

      {items.length === 0 && !candidatesQuery.isLoading ? (
        <p role="status">No candidates on this roster.</p>
      ) : (
        <div className="table-scroll">
          <table className="candidate-table batches-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">External ref</th>
                <th scope="col">Accommodations</th>
                <th scope="col">Status</th>
                {canWrite ? <th scope="col">Sign-in id</th> : null}
                {canWrite ? <th scope="col">Password</th> : null}
                {canWrite ? <th scope="col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((candidate) => (
                <tr key={candidate.id}>
                  <td>{candidate.name}</td>
                  <td>{candidate.externalRef || "None"}</td>
                  <td>
                    {candidate.accommodations.length > 0
                      ? candidate.accommodations.join(", ")
                      : "None"}
                  </td>
                  <td>
                    <span
                      className={
                        candidate.active
                          ? "status-badge status-accepted"
                          : "status-badge status-cancelled"
                      }
                    >
                      {candidate.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canWrite ? (
                    <td>{candidate.login?.loginId ?? "No login"}</td>
                  ) : null}
                  {canWrite ? (
                    <td>
                      {!candidate.login ? (
                        "None"
                      ) : candidate.login.initialPassword ? (
                        <code>{candidate.login.initialPassword}</code>
                      ) : (
                        "Changed by the student"
                      )}
                    </td>
                  ) : null}
                  {canWrite ? (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={loginBusyId === candidate.id}
                          onClick={() =>
                            void handleLogin(
                              candidate,
                              Boolean(candidate.login),
                            )
                          }
                        >
                          {candidate.login ? "New password" : "Create login"}
                          <span className="visually-hidden">
                            {" "}
                            for {candidate.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={!writable}
                          onClick={() => {
                            setActionError(null);
                            setSelectedCandidate(candidate);
                            setDialogMode("edit");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={
                            !writable || deactivatingId === candidate.id
                          }
                          onClick={() => void handleToggleActive(candidate)}
                        >
                          {candidate.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogMode ? (
        <CandidateDialog
          mode={dialogMode}
          batchId={batch.id}
          candidate={selectedCandidate}
          canOverride={canOverride}
          onCancel={() => {
            setDialogMode(null);
            setSelectedCandidate(null);
          }}
          onSaved={handleSuccess}
        />
      ) : null}

      {showImportDialog ? (
        <CandidateImportDialog
          batchId={batch.id}
          canOverride={canOverride}
          onCancel={() => setShowImportDialog(false)}
          onImportComplete={handleImportComplete}
        />
      ) : null}
    </section>
  );
}
