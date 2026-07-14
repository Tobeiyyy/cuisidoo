import { useQuery } from "@tanstack/react-query";
import type { Recipe } from "../shared/types";

export class UnauthorizedError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Fetches a single full recipe by id. Reused by cooking mode (Task 16). */
export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ["recipe", id],
    queryFn: () => api<Recipe>(`/api/recipes/${id}`),
    enabled: !!id,
  });
}
