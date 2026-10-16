import type { Role } from "../routing/access";
import { isRole } from "../routing/access";
import { ApiError, apiRequest, apiRequestResult } from "./client";

/**
 * Users administration. Paths and the two password-reset bodies are in
 * API_CONTRACT.md. The list query and the public user fields follow
 * server/src/modules/users (B-08). See DECISIONS.md open questions 47â€“50.
 */

/** Matches server USER_PAGE_SIZE_DEFAULT. The screen also offers 50 and 100. */
export const USER_PAGE_SIZE_DEFAULT = 20;
export const USER_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type UserPageSize = (typeof USER_PAGE_SIZE_OPTIONS)[number];

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  linkedProfileId: string | null;
  abId: string | null;
  tpId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserListQuery = {
  role?: Role;
  active?: boolean;
  page?: number;
  pageSize?: number;
};

export type UserListPage = {
  page: number;
  pageSize: number;
  total: number;
  items: UserRecord[];
};

export type CreateUserInput = {
  email: string;
  name: string;
  role: Role;
  password: string;
  active: boolean;
  linkedProfileId?: string;
  abId?: string;
  tpId?: string;
};

export type PatchUserInput = {
  email?: string;
  name?: string;
  role?: Role;
  active?: boolean;
  linkedProfileId?: string | null;
  abId?: string | null;
  tpId?: string | null;
};

export type PasswordResetResult =
  { kind: "set" } | { kind: "email"; emailQueued: boolean };

function usersResponseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Users response was not recognised.",
  );
}

function resetResponseError(): ApiError {
  return new ApiError(
    502,
    "INVALID_RESPONSE",
    "Password reset response was not recognised.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function wholeNumber(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    return null;
  return value;
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

/** Copies the public user only. password, passwordHash, and tokens are dropped. */
export function parseUser(value: unknown): UserRecord {
  if (!isRecord(value)) throw usersResponseError();
  if (typeof value.id !== "string" || value.id.length === 0)
    throw usersResponseError();
  if (typeof value.email !== "string" || value.email.length === 0)
    throw usersResponseError();
  if (typeof value.name !== "string" || value.name.length === 0)
    throw usersResponseError();
  if (typeof value.role !== "string" || !isRole(value.role))
    throw usersResponseError();
  if (typeof value.active !== "boolean") throw usersResponseError();
  if (typeof value.mustChangePassword !== "boolean") throw usersResponseError();
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0)
    throw usersResponseError();
  if (typeof value.updatedAt !== "string" || value.updatedAt.length === 0)
    throw usersResponseError();

  const linkedProfileId = nullableId(value.linkedProfileId);
  const abId = nullableId(value.abId);
  const tpId = nullableId(value.tpId);
  if (linkedProfileId === undefined || abId === undefined || tpId === undefined)
    throw usersResponseError();

  return {
    id: value.id,
    email: value.email,
    name: value.name,
    role: value.role,
    active: value.active,
    mustChangePassword: value.mustChangePassword,
    linkedProfileId,
    abId,
    tpId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseUserList(value: unknown): UserListPage {
  if (!isRecord(value) || !Array.isArray(value.items))
    throw usersResponseError();
  const page = wholeNumber(value.page, 1);
  const pageSize = wholeNumber(value.pageSize, 1);
  const total = wholeNumber(value.total, 0);
  if (page === null || pageSize === null || total === null)
    throw usersResponseError();
  return {
    page,
    pageSize,
    total,
    items: value.items.map((item) => parseUser(item)),
  };
}

export function isUserPageSize(value: number): value is UserPageSize {
  return (USER_PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export async function listUsers(
  query: UserListQuery,
  signal?: AbortSignal,
): Promise<UserListPage> {
  const params = new URLSearchParams();
  if (query.role) params.set("role", query.role);
  if (query.active !== undefined)
    params.set("active", query.active ? "true" : "false");
  params.set("page", String(query.page && query.page > 0 ? query.page : 1));
  const pageSize =
    query.pageSize && isUserPageSize(query.pageSize)
      ? query.pageSize
      : USER_PAGE_SIZE_DEFAULT;
  params.set("pageSize", String(pageSize));

  const body = await apiRequest<unknown>(`/users?${params.toString()}`, {
    signal,
  });
  return parseUserList(body);
}

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const body = await apiRequest<unknown>("/users", {
    method: "POST",
    body: input,
  });
  return parseUser(body);
}

export async function updateUser(
  id: string,
  input: PatchUserInput,
): Promise<UserRecord> {
  const body = await apiRequest<unknown>(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
  return parseUser(body);
}

/**
 * `newPassword` is success only on 204. `sendEmail: true` is success only on 202 `{ emailQueued }`.
 * Any other field on the 202 body is ignored, so a temporary password is not returned to the UI.
 */
export async function resetUserPassword(
  id: string,
  input: { newPassword: string } | { sendEmail: true },
): Promise<PasswordResetResult> {
  const result = await apiRequestResult<unknown>(
    `/users/${encodeURIComponent(id)}/password-reset`,
    {
      method: "POST",
      body: input,
    },
  );
  if (result.status === 204 && "newPassword" in input) return { kind: "set" };
  if (
    result.status === 202 &&
    "sendEmail" in input &&
    isRecord(result.body) &&
    typeof result.body.emailQueued === "boolean"
  ) {
    return { kind: "email", emailQueued: result.body.emailQueued };
  }
  throw resetResponseError();
}

/**
 * aa_admin "resend credentials" (decision 172, Q166).
 * Sets a new temporary password, mustChangePassword, revokes sessions, and queues credentials email.
 * Success is 202 `{ emailQueued }`.
 */
export async function resendCredentials(
  id: string,
): Promise<{ emailQueued: boolean }> {
  const result = await apiRequestResult<unknown>(
    `/users/${encodeURIComponent(id)}/resend-credentials`,
    {
      method: "POST",
      body: {},
    },
  );
  if (
    result.status === 202 &&
    isRecord(result.body) &&
    typeof result.body.emailQueued === "boolean"
  ) {
    return { emailQueued: result.body.emailQueued };
  }
  throw resetResponseError();
}
