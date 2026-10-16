import { useQuery } from "@tanstack/react-query";
import { listQualifications, type Nos, type Qualification } from "../../api/masterData";

/** All qualifications (100 a call, as many calls as the list needs) for the filters and forms. */
async function loadAll(signal?: AbortSignal): Promise<Qualification[]> {
  const all: Qualification[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await listQualifications({ page, pageSize: 100 }, signal);
    all.push(...result.items);
    if (all.length >= result.total || result.items.length === 0) break;
  }
  return all;
}

export function useQualifications(enabled = true) {
  return useQuery({
    queryKey: ["qb-qualifications"],
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) => loadAll(signal),
  });
}

export function qualificationLabel(list: readonly Qualification[] | undefined, id: string): string {
  const found = list?.find((item) => item.id === id);
  return found ? `${found.code} ${found.name}` : id;
}

export function nosOf(list: readonly Qualification[] | undefined, qualificationId: string): Nos[] {
  return list?.find((item) => item.id === qualificationId)?.nos ?? [];
}

export function nosLabel(nos: readonly Nos[], nosId: string): string {
  const found = nos.find((item) => item.nosId === nosId);
  return found ? found.code : nosId;
}

export function pcLabel(nos: readonly Nos[], nosId: string, pcId: string): string {
  const found = nos.find((item) => item.nosId === nosId)?.pcs.find((pc) => pc.pcId === pcId);
  return found ? found.code : pcId;
}
