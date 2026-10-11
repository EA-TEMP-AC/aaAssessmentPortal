import type { BatchStatus } from "../../api/batches";
import { BATCH_STATUS_LABELS } from "./labels";

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true" className="status-badge-mark">
        ●
      </span>
      {BATCH_STATUS_LABELS[status]}
    </span>
  );
}
