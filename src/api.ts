import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import type { NutritionScore, Recipe } from "../shared/types";

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

/** Triggers (or re-triggers with force=1) the cached nutrition score for a recipe. */
export function useScoreRecipe(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (force?: boolean) => {
      const res = await fetch(`/api/recipes/${id}/score${force ? "?force=1" : ""}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Nutrition-Score fehlgeschlagen. Bitte später erneut versuchen.");
      }
      return res.json() as Promise<NutritionScore>;
    },
    onSuccess: (nutrition) => {
      queryClient.setQueryData<Recipe | undefined>(["recipe", id], (old) =>
        old ? { ...old, nutrition } : old);
    },
  });
}
