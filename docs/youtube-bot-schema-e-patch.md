# Schema E Patch for YouTube Summarizer Bot

**Instructions:** Add the following blocks to your existing bot prompt in the locations indicated.

---

## 1. Add to `INTELLIGENT SCHEMA DETECTION` section (after Schema D)

Paste this after the Schema D block:

```
#### Schema E: The Recipe Extract
* **Trigger:** Content demonstrates cooking, baking, food preparation, or is a recipe compilation/list
* **Structure:**
    1. **Dish** — Name of the dish, cuisine origin if mentioned, approximate total time
    2. **Servings** — How many portions the recipe yields (if stated; otherwise `Servings not stated`)
    3. **Ingredients** — One line per ingredient: `- {quantity} {unit} {name}` (e.g., `- 500 g Hähnchenbrust`). Group under `### Für {section}` sub-headers when the recipe has distinct components (dough, filling, sauce, etc.). If quantity is vague ("a handful", "some"), write it as-is — do not fabricate precise amounts
    4. **Steps** — Numbered list, each step is one discrete action. Include time and temperature where mentioned. Flag equipment in brackets at the end of the step: `[Ofen]`, `[Standmixer]`, `[Pfanne]`, `[Herd]`, `[Grill]`, `[Mikrowelle]`, etc. Steps that are pure handwork (cutting, mixing by hand) get no equipment tag
    5. **Tips & Variations** — Substitutions, common mistakes, storage advice, or variations the creator mentions. Omit section entirely if none
* **Multi-recipe rule:** If the video contains multiple distinct recipes (compilation, "top 10", meal prep series, "what I eat in a day"), apply this schema **once per recipe** as separate sections under `## Recipe N: {Title} [{timestamp}]`. Each recipe gets its own complete Dish / Servings / Ingredients / Steps / Tips structure. Do not merge ingredients across recipes
* **Language:** Write ingredient names, step descriptions, and section headers in German. Translate from English source material. Use standard German cooking terminology (e.g., "anbraten" not "anrösten", "würfeln" not "in Würfel schneiden")
* **Ingredient formatting rules:**
    * Mass: `{number} g` or `{number} kg` (e.g., `500 g Mehl`)
    * Volume: `{number} ml` or `{number} l` (e.g., `200 ml Milch`)
    * Count: `{number} Stück` (e.g., `3 Stück Eier`) — or just `{number} {name}` when the unit is obvious (e.g., `2 Zitronen`)
    * Informal: `1 Prise`, `1 TL`, `1 EL`, `1 Msp.` — use these abbreviations, not spelled out
    * Sections: When a recipe has grouped ingredients (e.g., dough + filling), use `### Für den Teig` / `### Für die Füllung` sub-headers
```

## 2. Add to Schema Selection Priority Rule

Find this line in your prompt:
```
**Schema Selection Priority Rule:** If content triggers two schemas equally...
```

Add this sentence at the end of that paragraph:
```
Cooking content always triggers Schema E regardless of secondary schema matches — a cooking tutorial is Schema E (not Schema A), a cooking debate/podcast is Schema E (not Schema C), a food history documentary is Schema E + D hybrid.
```

## 3. Add to Short-Form Exception

Find the short-form exception paragraph. Add:
```
**Short-Form Exception for Schema E:** For cooking videos under 8 minutes with a single recipe, compress by merging Dish + Servings into one line and omitting Tips if the creator mentioned none. Multi-recipe compilations under 8 minutes are unlikely but handled normally if they occur.
```

## 4. Add Reference Output to `REFERENCE OUTPUTS` section

Paste after the Schema D reference:

```
#### Schema E Reference (Single Recipe)
```

```
# One-Pan Lemon Herb Chicken

**Tags:** [[youtube]], [[chicken]], [[one-pan]], [[meal-prep]]
**Source:** https://youtube.com/watch?v=example
**Author:** Pro Home Cooks
**Schema Applied:** E

## Dish

One-Pan Lemon Herb Chicken — Mediterran, ~45 Min [00:15](https://youtu.be/example?t=15s)

## Servings

4 Portionen

## Ingredients

- 4 Stück Hähnchenschenkel (mit Knochen)
- 500 g Kartoffeln (gewürfelt)
- 2 Stück Zitronen
- 4 Zehen Knoblauch
- 3 EL Olivenöl
- 1 TL Thymian (getrocknet)
- 1 TL Rosmarin (getrocknet)
- Salz und Pfeffer nach Geschmack

## Steps

1. Ofen auf 200°C vorheizen [01:30](https://youtu.be/example?t=1m30s) [Ofen]
2. Kartoffeln würfeln und auf ein Backblech verteilen [02:10](https://youtu.be/example?t=2m10s)
3. Hähnchen mit Olivenöl, Kräutern, Salz und Pfeffer einreiben [03:45](https://youtu.be/example?t=3m45s)
4. Zitrone halbieren, Saft über Kartoffeln und Hähnchen verteilen [04:20](https://youtu.be/example?t=4m20s)
5. Knoblauch zerdrücken und zwischen die Kartoffeln geben [04:50](https://youtu.be/example?t=4m50s)
6. Hähnchen auf die Kartoffeln setzen, 35–40 Min backen bis goldbraun [05:15](https://youtu.be/example?t=5m15s) [Ofen]
7. 5 Min ruhen lassen vor dem Servieren [06:30](https://youtu.be/example?t=6m30s)

## Tips & Variations

> Kartoffeln möglichst gleichmäßig würfeln damit sie gleichzeitig gar werden [03:00](https://youtu.be/example?t=3m)

> Variante: Süßkartoffeln statt normaler Kartoffeln für mehr Süße [06:45](https://youtu.be/example?t=6m45s)
```

```
#### Schema E Reference (Multi-Recipe Compilation)
```

```
# 5 Easy 15-Minute Dinners

**Tags:** [[youtube]], [[meal-prep]], [[quick-meals]], [[weeknight-dinner]]
**Source:** https://youtube.com/watch?v=example
**Author:** Joshua Weissman
**Schema Applied:** E

> Note: Multi-recipe compilation — 5 recipes extracted individually.

## Recipe 1: Knoblauch-Butter Garnelen Pasta [00:30](https://youtu.be/example?t=30s)

### Dish
Knoblauch-Butter Garnelen Pasta — Italienisch, ~12 Min

### Servings
2 Portionen

### Ingredients
- 200 g Spaghetti
- 250 g Garnelen (geschält)
- 4 Zehen Knoblauch (gehackt)
- 2 EL Butter
- 1 EL Olivenöl
- 1 Prise Chiliflocken
- Salz und Pfeffer nach Geschmack

### Steps
1. Pasta in Salzwasser kochen [00:45](https://youtu.be/example?t=45s) [Herd]
2. Garnelen in Olivenöl scharf anbraten, 2 Min pro Seite [02:10](https://youtu.be/example?t=2m10s) [Pfanne]
3. Knoblauch und Chiliflocken dazu, 30 Sek anbraten [03:30](https://youtu.be/example?t=3m30s) [Pfanne]
4. Butter und 2 EL Pastawasser einrühren [04:00](https://youtu.be/example?t=4m)
5. Pasta unterheben, durchschwenken [04:20](https://youtu.be/example?t=4m20s)

## Recipe 2: Teriyaki Hähnchen Bowl [05:00](https://youtu.be/example?t=5m)

### Dish
Teriyaki Hähnchen Bowl — Japanisch, ~15 Min

### Servings
2 Portionen

### Ingredients
- 300 g Hähnchenbrust (in Streifen)
- 200 g Reis (gekocht)
- 3 EL Sojasauce
- 2 EL Honig
- 1 EL Reisessig
- 1 TL Ingwer (gerieben)
- 1 Stück Frühlingszwiebel

### Steps
1. Hähnchen in Streifen schneiden [05:15](https://youtu.be/example?t=5m15s)
2. In heißer Pfanne anbraten bis goldbraun, 4–5 Min [05:45](https://youtu.be/example?t=5m45s) [Pfanne]
3. Sojasauce, Honig, Reisessig und Ingwer mischen [06:30](https://youtu.be/example?t=6m30s)
4. Sauce zum Hähnchen geben, einkochen lassen bis glasig [07:00](https://youtu.be/example?t=7m)
5. Auf Reis anrichten, mit Frühlingszwiebeln garnieren [07:30](https://youtu.be/example?t=7m30s)

[... Recipe 3–5 continue in same pattern ...]
```

## 5. Add to Edge Case Handling table

Add this row:

```
| Content is a cooking video but recipe details are vague (no quantities, improvised) | Extract what's stated; use `nach Geschmack` or `ca.` for imprecise amounts. Add: `> Note: Creator did not provide exact measurements — quantities are approximate.` |
```
