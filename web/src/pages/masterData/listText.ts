export function listSummary(page: number, pageSize: number, total: number, one: string, many: string): string {
  const pages = pageSize < 1 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const noun = total === 1 ? one : many;
  return `Page ${page} of ${pages}. ${pageSize} per page. ${total} ${noun}.`;
}

export function emptyListMessage(many: string, filtered: boolean): string {
  if (filtered) return `No ${many} match these filters.`;
  return `No ${many} are available for your account.`;
}

export const SCOPE_NOTE =
  "This list shows only the records your account is allowed to read. It may not include every record.";

export const READ_ONLY_NOTE = "You can view these records. Your role cannot create, edit, or remove them.";
