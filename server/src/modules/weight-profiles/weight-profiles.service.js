import { AppError, notFound } from "../../lib/errors.js";
import { WeightProfile } from "../../models/weight-profile.model.js";
import { findQualification } from "../test-generator/test-generator.service.js";

async function qualificationIdOf(ref) {
  return ref ? (await findQualification(ref))._id : null;
}

async function latestOf(rootId) {
  const latest = await WeightProfile.findOne({ rootProfileId: rootId }).sort({ version: -1 });
  if (!latest) throw notFound("Weight profile not found");
  return latest;
}

export async function createProfile(user, data) {
  const doc = new WeightProfile({
    name: data.name,
    qualificationId: await qualificationIdOf(data.qualificationId),
    difficultyWeights: data.difficultyWeights,
    bloomWeights: data.bloomWeights,
    version: 1,
    status: "draft",
    isLatest: true,
    createdBy: user._id,
  });
  doc.rootProfileId = doc._id;
  await doc.save();
  return doc;
}

/** Every edit inserts a new draft version; the old version is kept, only isLatest changes. */
export async function editProfile(user, rootId, data) {
  const previous = await latestOf(rootId);
  if (data.expectedVersion !== undefined && data.expectedVersion !== previous.version) {
    throw new AppError(409, "WEIGHT_PROFILE_STALE_VERSION", "The profile has a newer version", {
      latestVersion: previous.version,
    });
  }
  const next = new WeightProfile({
    rootProfileId: previous.rootProfileId,
    version: previous.version + 1,
    name: data.name ?? previous.name,
    qualificationId:
      data.qualificationId === undefined
        ? previous.qualificationId
        : await qualificationIdOf(data.qualificationId),
    difficultyWeights: data.difficultyWeights ?? previous.difficultyWeights,
    bloomWeights: data.bloomWeights ?? previous.bloomWeights,
    status: "draft",
    isLatest: true,
    createdBy: user._id,
  });
  try {
    await next.save();
  } catch (err) {
    if (err?.code === 11000) {
      throw new AppError(
        409,
        "WEIGHT_PROFILE_STALE_VERSION",
        "Another edit created this version first; reload",
      );
    }
    throw err;
  }
  await WeightProfile.updateOne({ _id: previous._id }, { $set: { isLatest: false } });
  return { profile: next, previous };
}

export async function approveProfile(user, rootId, version) {
  const latest = await latestOf(rootId);
  const target =
    version === undefined || version === latest.version
      ? latest
      : await WeightProfile.findOne({ rootProfileId: rootId, version });
  if (!target) throw notFound("Weight profile version not found");
  if (target.status === "approved") {
    throw new AppError(409, "WEIGHT_PROFILE_ALREADY_APPROVED", "This version is already approved");
  }
  if (target.version !== latest.version) {
    throw new AppError(
      409,
      "WEIGHT_PROFILE_VERSION_SUPERSEDED",
      "A newer version exists; approve the latest version",
      { latestVersion: latest.version },
    );
  }
  const before = target.toObject();
  target.status = "approved";
  target.approvedBy = user._id;
  target.approvedAt = new Date();
  await target.save();
  return { profile: target, before };
}

export async function getProfile(rootId, version) {
  const doc =
    version === undefined
      ? await latestOf(rootId)
      : await WeightProfile.findOne({ rootProfileId: rootId, version });
  if (!doc) throw notFound("Weight profile version not found");
  return doc;
}

export async function listVersions(rootId) {
  const items = await WeightProfile.find({ rootProfileId: rootId }).sort({ version: 1 }).lean();
  if (items.length === 0) throw notFound("Weight profile not found");
  return { items, total: items.length };
}

/** Latest version of each profile. */
export async function listProfiles(filters) {
  const query = { isLatest: true };
  if (filters.qualificationId) {
    query.qualificationId = (await findQualification(filters.qualificationId))._id;
  }
  if (filters.status) query.status = filters.status;
  const [total, items] = await Promise.all([
    WeightProfile.countDocuments(query),
    WeightProfile.find(query)
      .sort({ createdAt: -1 })
      .skip((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .lean(),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}
