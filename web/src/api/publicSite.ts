import { ApiError, apiRequest } from "./client";

/**
 * Admin calls for the public website content: /admin/public-site/:slug.
 * API_CONTRACT.md "Public website content" and "Public site endpoints". Items are plain
 * records because the nine sections have different fields (see pages/publicSite/sections.ts).
 */

export const PUBLIC_SITE_PAGE_SIZE = 20;

export type PublicSiteItem = {
  id: string;
  published: boolean;
  archived: boolean;
  sortOrder: number;
  updatedAt: string | null;
  fields: Record<string, unknown>;
};

export type PublicSiteList = {
  page: number;
  pageSize: number;
  total: number;
  items: PublicSiteItem[];
};

export type PublicSiteQuery = {
  page?: number;
  pageSize?: number;
  published?: boolean;
  archived?: boolean;
};

function invalid(what: string): ApiError {
  return new ApiError(502, "INVALID_RESPONSE", `${what} response was not recognised.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePublicSiteItem(value: unknown): PublicSiteItem {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw invalid("Public site item");
  }
  return {
    id: value.id,
    published: value.published === true,
    archived: value.archived === true,
    sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : 0,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    fields: value,
  };
}

function path(slug: string, id?: string): string {
  const base = `/admin/public-site/${encodeURIComponent(slug)}`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

export async function listPublicSite(
  slug: string,
  query: PublicSiteQuery = {},
  signal?: AbortSignal,
): Promise<PublicSiteList> {
  const params = new URLSearchParams();
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  params.set("pageSize", String(query.pageSize && query.pageSize > 0 ? query.pageSize : PUBLIC_SITE_PAGE_SIZE));
  if (query.published !== undefined) params.set("published", query.published ? "true" : "false");
  if (query.archived !== undefined) params.set("archived", query.archived ? "true" : "false");
  const body = await apiRequest<unknown>(`${path(slug)}?${params.toString()}`, { signal });
  if (!isRecord(body) || !Array.isArray(body.items)) throw invalid("Public site list");
  return {
    page: typeof body.page === "number" ? body.page : 1,
    pageSize: typeof body.pageSize === "number" ? body.pageSize : body.items.length,
    total: typeof body.total === "number" ? body.total : body.items.length,
    items: body.items.map(parsePublicSiteItem),
  };
}

export async function createPublicSiteItem(slug: string, body: Record<string, unknown>): Promise<PublicSiteItem> {
  return parsePublicSiteItem(await apiRequest<unknown>(path(slug), { method: "POST", body }));
}

export async function updatePublicSiteItem(
  slug: string,
  id: string,
  body: Record<string, unknown>,
): Promise<PublicSiteItem> {
  return parsePublicSiteItem(await apiRequest<unknown>(path(slug, id), { method: "PATCH", body }));
}

/** DELETE archives the item on the server. Nothing is ever deleted. */
export async function archivePublicSiteItem(slug: string, id: string): Promise<void> {
  await apiRequest<void>(path(slug, id), { method: "DELETE" });
}
