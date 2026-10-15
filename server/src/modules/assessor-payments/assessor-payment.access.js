import { forbidden } from "../../lib/errors.js";
import { getAccessSettings } from "../settings/settings.service.js";

/**
 * ab_reviewer reads assessor payments only while aa_admin has switched
 * `abReviewerCanReadAssessorPayments` on (decision 174, Q161). Default is denied.
 */
export async function forbidUnlessAbReviewerAllowed(req, _res, next) {
  if (req.user?.role === "ab_reviewer") {
    const settings = await getAccessSettings();
    if (!settings.abReviewerCanReadAssessorPayments || !req.user.abId) throw forbidden();
  }
  next();
}
