/**
 * Content-theft controls. S-02. "Zero content theft" is a project goal.
 *
 * Every number here is a PROPOSED default (DECISIONS.md Q460). Edit this file to change a limit.
 * There is no environment override.
 *
 *   CONTENT_READ_DAILY_CAP        questions one user may read per IST day, unless a role below overrides it
 *   CONTENT_READ_ROLE_CAPS        per-role override of the cap above
 *   MAX_QUESTIONS_PER_PAGE        no endpoint returns more than this many questions with answers per page
 *
 * A "content read" is one question (stem, options, answer) carried in a response. A page of 50
 * questions counts 50. Listings of ids, counts or paper headers carry no content and count 0.
 */
export const CONTENT_READ_DAILY_CAP = 500;

export const CONTENT_READ_ROLE_CAPS = Object.freeze({});

export const MAX_QUESTIONS_PER_PAGE = 50;

/** The daily cap for a role. */
export function contentReadCapFor(role) {
  return CONTENT_READ_ROLE_CAPS[role] ?? CONTENT_READ_DAILY_CAP;
}
