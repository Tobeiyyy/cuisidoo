import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import type { NutritionScore, Recipe, UnitDim } from "../shared/types";
import type { Suggestion } from "../worker/suggest";
import type { ScannedItem } from "../worker/scan";
export type { ScannedItem };
import {
  getMirroredRecipe,
  mirrorRecipe,
  queueCheck,
  removePendingChecks,
  updateMirroredShoppingItem,
} from "./offline";

export class UnauthorizedError extends Error {}

/** Shape of a shopping-list row, shared between Einkaufen.tsx and the offline mirror (Task 17). */
export interface ShoppingItem {
  id: number;
  ingredient_id: number | null;
  label: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  checked: boolean;
  source: "plan" | "manual";
}

/** A recipe as returned to pages, with an extra marker set when served from the offline mirror. */
export type RecipeWithOfflineFlag = Recipe & { offline?: boolean };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Fetches a single full recipe by id. Reused by cooking mode (Task 16). On success the recipe is
 * mirrored to IndexedDB (Task 17); on fetch failure it falls back to the mirrored copy (if any)
 * with `offline: true` set so RezeptDetail/Kochmodus can show a small badge. Signature and
 * queryKey are unchanged so existing callers don't need to change beyond reading `.offline`.
 */
export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ["recipe", id],
    queryFn: async (): Promise<RecipeWithOfflineFlag> => {
      try {
        const recipe = await api<Recipe>(`/api/recipes/${id}`);
        void mirrorRecipe(recipe).catch(() => {});
        return recipe;
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        const mirrored = id ? await getMirroredRecipe(Number(id)) : null;
        if (mirrored) return { ...mirrored, offline: true };
        throw err;
      }
    },
    enabled: !!id,
  });
}

/**
 * Sets a shopping-list item's checked state. Single call-site for the mutation, which is why
 * Task 17's offline outbox slots in here without touching Einkaufen.tsx's call site: offline (or
 * on a failed PATCH) the change is queued in IndexedDB and replayed once connectivity returns.
 */
export async function toggleItem(id: number, checked: boolean): Promise<void> {
  // A newer toggle always supersedes any older queued-but-not-yet-flushed PATCH for the same
  // item, so drop it first — otherwise a stale outbox entry could replay after this one and
  // clobber the server with the older value.
  await removePendingChecks(id);
  if (!navigator.onLine) {
    await queueCheck(id, checked);
    return;
  }
  try {
    await api(`/api/shopping/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ checked }),
    });
    void updateMirroredShoppingItem(id, checked).catch(() => {});
  } catch {
    await queueCheck(id, checked);
  }
}

/**
 * Downscales an image file client-side (createImageBitmap preserves EXIF orientation by default)
 * to at most 1280px on the longest edge and re-encodes as JPEG q0.8, so uploads stay small and
 * consistent regardless of the source photo's resolution or format.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encoding failed"))), "image/jpeg", 0.8);
  });
}

/** Uploads a (already downscaled) JPEG blob as the recipe's photo; returns the new image_key. */
export async function uploadRecipeImage(id: string | number, blob: Blob): Promise<{ image_key: string }> {
  const res = await fetch(`/api/recipes/${id}/image`, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

/** Removes a recipe's photo (both the R2 object and the image_key column). */
export async function deleteRecipeImage(id: string | number): Promise<void> {
  await api(`/api/recipes/${id}/image`, { method: "DELETE" });
}

/** Creates a new ingredient (with a pantry row) for free-form additions on the Vorrat page. */
export async function createIngredient(data: {
  name: string; category: string; unit_dim: UnitDim; amountless?: boolean;
}): Promise<{ id: number }> {
  const res = await fetch("/api/ingredients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "same-origin",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Fehler ${res.status}`);
  }
  return res.json();
}

/** Fetches 3 pantry-aware "surprise me" recipe idea suggestions. */
export async function fetchSuggestions(portionen: number, extraGeraeteErlaubt: boolean): Promise<Suggestion[]> {
  const res = await api<{ suggestions: Suggestion[] }>("/api/generate/suggest", {
    method: "POST",
    body: JSON.stringify({ portionen, extraGeraeteErlaubt }),
  });
  return res.suggestions;
}

/** Result of a recipe import: either a multi-recipe suggestion list, or a full RecipeSaveInput-shaped draft. */
export interface ImportResult {
  multi?: boolean;
  suggestions?: Suggestion[];
  title?: string;
  // ... all RecipeSaveInput fields when single recipe
  [key: string]: any;
}

/** Imports a recipe from pasted text or a URL, adapting it for the TM6 (Task 5). */
export async function importRecipe(data: {
  input: string; portionen: number; extraGeraeteErlaubt: boolean; selectedTitle?: string;
}): Promise<ImportResult> {
  return api<ImportResult>("/api/generate/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** A single ingredient missing (fully or partially) from the pantry, scaled to the requested servings. */
export interface MissingIngredient {
  ingredient_id: number; name: string; needed: number; available: number; unit: string;
}

/** Checks how much of each ingredient is missing from the pantry for a recipe at the given servings (Task 7). */
export async function checkPantry(recipeId: string | number, servings: number): Promise<MissingIngredient[]> {
  const res = await api<{ missing: MissingIngredient[] }>(`/api/recipes/${recipeId}/check-pantry?servings=${servings}`);
  return res.missing;
}

/** Adds a batch of missing ingredients to the shopping list, one POST per item (Task 7). */
export async function addToShoppingList(items: { ingredient_id: number; label: string; quantity: number; unit: string; category: string }[]): Promise<void> {
  for (const item of items) {
    await api("/api/shopping", {
      method: "POST",
      body: JSON.stringify({
        label: item.label,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category || "Sonstiges",
      }),
    });
  }
}

/**
 * Builds a full `PUT /api/recipes/:id` body for a tags-only edit (RezeptDetail's inline tag
 * chips, Kochmodus's "Ausprobiert" flag): the endpoint replaces the whole recipe row, so every
 * other field is echoed back unchanged and only `tags` differs.
 *
 * Ingredient `category`/`unit_dim` are part of the request shape but are only ever read when an
 * ingredient name doesn't already match the catalog — which can't happen here, since every
 * ingredient in `recipe.ingredients` came from the catalog via this same recipe. The placeholder
 * values below satisfy the shape check and are never actually persisted.
 */
export function buildTagsUpdate(recipe: Recipe, tags: string[]) {
  return {
    title: recipe.title,
    description: recipe.description,
    servings_base: recipe.servings_base,
    total_time_min: recipe.total_time_min,
    active_time_min: recipe.active_time_min,
    tags,
    equipment: recipe.equipment,
    ingredients: recipe.ingredients.map((ing) => ({
      name: ing.name,
      category: "Sonstiges",
      unit_dim: "mass" as const,
      quantity: ing.quantity,
      unit: ing.unit,
      scaling: ing.scaling,
      note: ing.note,
      section: ing.section,
    })),
    steps: recipe.steps,
  };
}

/** Scans a receipt image and returns matched pantry items for confirmation. */
export async function scanReceipt(blob: Blob): Promise<ScannedItem[]> {
  const res = await fetch("/api/pantry/scan", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Fehler ${res.status}`);
  }
  const data = await res.json() as { items: ScannedItem[] };
  return data.items;
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
