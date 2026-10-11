import type { Role } from "../routing/access";

/**
 * SCHEMA §5 gives aa_admin and mis full master-data access, and ab_reviewer and
 * ncvet_viewer read access. B-07a also lets tp read their training partner and
 * its centres, and a candidate read their own learner. Writes stay aa_admin and mis.
 * See DECISIONS.md open question 63.
 */
export const MASTER_COLLECTIONS = [
  "awarding-bodies",
  "training-partners",
  "centres",
  "qualifications",
  "learners",
] as const;

export type MasterCollection = (typeof MASTER_COLLECTIONS)[number];

const READERS: Record<MasterCollection, readonly Role[]> = {
  "awarding-bodies": ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"],
  "training-partners": ["aa_admin", "mis", "tp", "ncvet_viewer"],
  centres: ["aa_admin", "mis", "tp", "ncvet_viewer"],
  qualifications: ["aa_admin", "mis", "ab_reviewer", "ncvet_viewer"],
  learners: ["aa_admin", "mis", "candidate", "ncvet_viewer"],
};

export const MASTER_COLLECTION_META: Record<
  MasterCollection,
  { title: string; one: string; many: string; lede: string }
> = {
  "awarding-bodies": {
    title: "Awarding bodies",
    one: "awarding body",
    many: "awarding bodies",
    lede: "Awarding bodies that can receive assessment notifications.",
  },
  "training-partners": {
    title: "Training partners",
    one: "training partner",
    many: "training partners",
    lede: "Training partners linked to centres.",
  },
  centres: {
    title: "Centres",
    one: "centre",
    many: "centres",
    lede: "Centres belong to a training partner.",
  },
  qualifications: {
    title: "Qualifications",
    one: "qualification",
    many: "qualifications",
    lede: "Qualifications, including NOS, performance criteria, and pass marks.",
  },
  learners: {
    title: "Learners",
    one: "learner",
    many: "learners",
    lede: "Learners are the stable person records used across batches.",
  },
};

export function canReadMasterCollection(role: Role, collection: MasterCollection): boolean {
  return READERS[collection].includes(role);
}

export function canWriteMasterData(role: Role): boolean {
  return role === "aa_admin" || role === "mis";
}

export function masterCollectionsForRole(role: Role): MasterCollection[] {
  return MASTER_COLLECTIONS.filter((collection) => canReadMasterCollection(role, collection));
}

/** aa_admin, mis, and ncvet_viewer read every centre, so a tpId filter can narrow that list. */
export function readsEveryCentre(role: Role): boolean {
  return role === "aa_admin" || role === "mis" || role === "ncvet_viewer";
}

export function masterCollectionPath(collection: MasterCollection): string {
  return `/master-data/${collection}`;
}
