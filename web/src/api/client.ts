/**
 * API client placeholder. Wire endpoints against API_CONTRACT.md in F-01+.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export async function getHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json() as Promise<{ status: string }>;
}
