import { ACCESS_SETTINGS_KEY, AccessSettings } from "../../models/access-settings.model.js";

export function presentAccessSettings(doc) {
  return {
    abReviewerCanReadAssessorPayments: doc?.abReviewerCanReadAssessorPayments === true,
    ncvetViewerCanSeeAbQueue: doc?.ncvetViewerCanSeeAbQueue === true,
    aadhaarVisibility: doc?.aadhaarVisibility ?? "masked",
    updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

export async function getAccessSettings() {
  const doc = await AccessSettings.findOne({ key: ACCESS_SETTINGS_KEY }).lean();
  return presentAccessSettings(doc);
}

/** Merges the named flags into the singleton and returns the before and after views. */
export async function saveAccessSettings(body, actor) {
  const previous = await AccessSettings.findOne({ key: ACCESS_SETTINGS_KEY }).lean();
  const doc = await AccessSettings.findOneAndUpdate(
    { key: ACCESS_SETTINGS_KEY },
    { $set: { ...body, updatedBy: actor._id }, $setOnInsert: { key: ACCESS_SETTINGS_KEY } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();
  return { before: presentAccessSettings(previous), settings: presentAccessSettings(doc) };
}
