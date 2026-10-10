/**
 * Batch row scope. docs/SCHEMA.md §5:
 * aa_admin / mis / ncvet_viewer = all
 * ab_reviewer = abId
 * tp = tpId
 * assessor = assessorId (linkedProfileId)
 * proctor = proctorId (linkedProfileId)
 * candidate = batches containing their learner's candidate row
 * sme = no batch rows
 */

export function batchScopeFor(user) {
  switch (user?.role) {
    case "aa_admin":
    case "mis":
    case "ncvet_viewer":
      return { kind: "all" };
    case "ab_reviewer":
      return { kind: "field", field: "abId", value: user.abId ?? null };
    case "tp":
      return { kind: "field", field: "tpId", value: user.tpId ?? null };
    case "assessor":
      return { kind: "field", field: "assessorId", value: user.linkedProfileId ?? null };
    case "proctor":
      return { kind: "field", field: "proctorId", value: user.linkedProfileId ?? null };
    case "candidate":
      return { kind: "learner", learnerId: user.linkedProfileId ?? null };
    default:
      return { kind: "none" };
  }
}

/**
 * Mongo filter against the batches collection.
 * For candidates, pass batch ids resolved from the roster (linkedProfileId is a learner).
 */
export function batchQueryFilter(user, { candidateBatchIds } = {}) {
  const scope = batchScopeFor(user);
  if (scope.kind === "all") return {};
  if (scope.kind === "none") return { _id: { $in: [] } };
  if (scope.kind === "field") {
    if (scope.value == null) return { _id: { $in: [] } };
    return { [scope.field]: scope.value };
  }
  if (scope.kind === "learner") {
    return { _id: { $in: candidateBatchIds ?? [] } };
  }
  return { _id: { $in: [] } };
}

/**
 * @param {object} user
 * @param {object} batch
 * @param {{ learnerIds?: Array<unknown> }} [context]
 */
export function isInBatchScope(user, batch, context = {}) {
  const scope = batchScopeFor(user);
  if (scope.kind === "all") return true;
  if (scope.kind === "none" || !batch) return false;
  if (scope.kind === "field") {
    if (scope.value == null) return false;
    return String(batch[scope.field] ?? "") === String(scope.value);
  }
  if (scope.kind === "learner") {
    if (scope.learnerId == null) return false;
    const ids = context.learnerIds ?? [];
    return ids.some((id) => String(id) === String(scope.learnerId));
  }
  return false;
}
