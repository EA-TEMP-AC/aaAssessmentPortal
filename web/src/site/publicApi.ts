import { apiRequest } from "../api/client";

export type PublicSlug =
  | "team-members"
  | "organogram"
  | "people"
  | "sample-papers"
  | "industry-linkages"
  | "grievance"
  | "posh"
  | "office-documents"
  | "events";

export type PublicPage<T> = { page: number; pageSize: number; total: number; items: T[] };

export type TeamMember = {
  id: string;
  name: string;
  designation: string;
  department?: string | null;
  bio?: string | null;
  photoRef?: string | null;
};
export type OrgNode = { id: string; name: string; title: string; parentId?: string | null; photoRef?: string | null };
export type PublicPerson = {
  id: string;
  kind: "assessor" | "proctor";
  name: string;
  roleLabel: string;
  sector?: string | null;
  photoRef?: string | null;
};
export type SamplePaper = {
  id: string;
  title: string;
  fileRef?: string | null;
  qualification?: { code: string; name: string; sector?: string | null } | null;
};
export type Linkage = {
  id: string;
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoRef?: string | null;
};
export type Grievance = {
  id: string;
  title: string;
  body?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  fileRef?: string | null;
};
export type PoshItem = {
  id: string;
  kind: "policy" | "committee_member";
  title: string;
  body?: string | null;
  memberName?: string | null;
  memberRole?: string | null;
  fileRef?: string | null;
};
export type OfficeDocument = {
  id: string;
  category: string;
  title: string;
  note?: string | null;
  fileRef?: string | null;
  proofOnFile?: boolean;
};
export type PublicEvent = {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  endDate?: string | null;
  location?: string | null;
};

type Params = Record<string, string | number | undefined>;

function queryString(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Public reads send no token and never retry through the sign-in refresh. */
export async function fetchPublic<T>(slug: PublicSlug, params: Params = {}): Promise<PublicPage<T>> {
  const body = await apiRequest<Partial<PublicPage<T>>>(`/public/${slug}${queryString(params)}`, {
    auth: false,
    retryOn401: false,
  });
  return {
    page: typeof body?.page === "number" ? body.page : 1,
    pageSize: typeof body?.pageSize === "number" ? body.pageSize : 20,
    total: typeof body?.total === "number" ? body.total : 0,
    items: Array.isArray(body?.items) ? body.items : [],
  };
}

const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** For views that need every row (tree, calendar). Stops after 10 pages of 100. */
export async function fetchAllPublic<T>(slug: PublicSlug, params: Params = {}): Promise<PublicPage<T>> {
  const first = await fetchPublic<T>(slug, { ...params, page: 1, pageSize: MAX_PAGE_SIZE });
  const items = [...first.items];
  const pages = Math.min(Math.ceil(first.total / MAX_PAGE_SIZE), MAX_PAGES);
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPublic<T>(slug, { ...params, page, pageSize: MAX_PAGE_SIZE });
    items.push(...next.items);
  }
  return { page: 1, pageSize: MAX_PAGE_SIZE, total: first.total, items };
}

/** Only http and https references become links; anything else stays plain text. */
export function safeHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  try {
    const url = new URL(ref);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export const UTILITY_BILL_CATEGORIES = new Set(["telephone_bill", "internet_bill", "electricity_bill"]);
