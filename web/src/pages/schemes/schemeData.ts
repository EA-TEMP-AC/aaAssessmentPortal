import { useQuery } from "@tanstack/react-query";
import { listProjects, listSchemes } from "../../api/schemes";

export const SCHEME_DATA_KEY = "scheme-data";

export const SCOPE_LABELS = { scheme: "Scheme", project: "Project", agency: "Whole agency" } as const;

export type Option = { id: string; label: string };

/** Active schemes for a selector. Shared by the project form, the signatory form and the batch form. */
export function useSchemeOptions(enabled = true) {
  const query = useQuery({
    queryKey: [SCHEME_DATA_KEY, "scheme-options"],
    enabled,
    queryFn: ({ signal }) => listSchemes({ active: true, page: 1, pageSize: 100 }, signal),
  });
  const options: Option[] = (query.data?.items ?? []).map((item) => ({ id: item.id, label: `${item.name} (${item.code})` }));
  return { options, status: query.isError ? ("error" as const) : query.isPending ? ("loading" as const) : ("ready" as const) };
}

/** Active projects for a selector, limited to one scheme when `schemeId` is given. */
export function useProjectOptions(schemeId: string | null, enabled = true) {
  const query = useQuery({
    queryKey: [SCHEME_DATA_KEY, "project-options", schemeId ?? ""],
    enabled,
    queryFn: ({ signal }) => listProjects({ active: true, page: 1, pageSize: 100, schemeId: schemeId ?? undefined }, signal),
  });
  const options: Option[] = (query.data?.items ?? []).map((item) => ({ id: item.id, label: `${item.name} (${item.code})` }));
  return { options, status: query.isError ? ("error" as const) : query.isPending ? ("loading" as const) : ("ready" as const) };
}

