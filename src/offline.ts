import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Recipe } from "../shared/types";
import type { ShoppingItem } from "./api";

/**
 * Offline mirror for Task 17. Design notes (see task-17-report.md for the full writeup):
 *  - "recipes" store is keyed by numeric recipe id (matches Recipe.id) so mirrorRecipe/
 *    getMirroredRecipe are simple point lookups.
 *  - "shopping" store holds the *entire* list as a single blob under one fixed key ("list")
 *    rather than one row per item — the list is always fetched/replaced as a whole array by
 *    Einkaufen, so a single blob avoids reconciling per-item diffs against category ordering.
 *  - "outbox" is an autoIncrement, out-of-line-keyed store of pending {id, checked} PATCHes.
 *    Kept independent of src/api.ts's `api()` helper (this file does its own bare `fetch` for the
 *    PATCH replay) to avoid a circular import between api.ts (which calls into offline.ts for
 *    mirroring) and offline.ts.
 */

interface OutboxEntry {
  id: number;
  checked: boolean;
}

interface CuisidooDB extends DBSchema {
  recipes: { key: number; value: Recipe };
  shopping: { key: string; value: ShoppingItem[] };
  outbox: { key: number; value: OutboxEntry };
}

const SHOPPING_KEY = "list";

let dbPromise: Promise<IDBPDatabase<CuisidooDB>> | null = null;

function getDb(): Promise<IDBPDatabase<CuisidooDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CuisidooDB>("cuisidoo", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("recipes")) {
          db.createObjectStore("recipes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("shopping")) {
          db.createObjectStore("shopping");
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function mirrorRecipe(recipe: Recipe): Promise<void> {
  const db = await getDb();
  await db.put("recipes", recipe);
}

export async function getMirroredRecipe(id: number): Promise<Recipe | null> {
  const db = await getDb();
  const recipe = await db.get("recipes", id);
  return recipe ?? null;
}

export async function mirrorShoppingList(items: ShoppingItem[]): Promise<void> {
  const db = await getDb();
  await db.put("shopping", items, SHOPPING_KEY);
}

export async function getMirroredShoppingList(): Promise<ShoppingItem[]> {
  const db = await getDb();
  const items = await db.get("shopping", SHOPPING_KEY);
  return items ?? [];
}

/** Queues a pending checked-state PATCH and keeps the mirrored list showing it immediately. */
export async function queueCheck(id: number, checked: boolean): Promise<void> {
  const db = await getDb();
  await db.add("outbox", { id, checked });
  const items = await getMirroredShoppingList();
  if (items.length > 0) {
    await mirrorShoppingList(items.map((i) => (i.id === id ? { ...i, checked } : i)));
  }
}

/**
 * Replays queued PATCHes in FIFO order, deleting each as it succeeds. Stops at the first failure
 * (offline again, or server error) and leaves the rest queued for the next flush attempt.
 */
export async function flushOutbox(): Promise<void> {
  const db = await getDb();
  const pending: { key: number; value: OutboxEntry }[] = [];
  let cursor = await db.transaction("outbox").store.openCursor();
  while (cursor) {
    pending.push({ key: cursor.key, value: cursor.value });
    cursor = await cursor.continue();
  }

  for (const { key, value } of pending) {
    try {
      const res = await fetch(`/api/shopping/${value.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: value.checked }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await db.delete("outbox", key);
    } catch {
      break;
    }
  }
}
