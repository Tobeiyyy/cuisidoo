import type { UnitDim } from "../shared/types";

export interface PantryPromptItem {
  name: string;
  quantity: number;
  unit_dim: UnitDim;
  amountless: boolean;
}

export function buildSystemPrompt(opts: {
  equipmentOwned: string[]; dietBias: string; canonicalNames: string[]; extraGeraeteErlaubt: boolean;
  pantry?: PantryPromptItem[];
}): string {
  const geraeteRegel = opts.extraGeraeteErlaubt
    ? `Zusätzlich zum TM6 dürfen verwendet werden: ${opts.equipmentOwned.join(", ")}. Schritte an diesen Geräten sind kind="off_device" mit gesetztem device.`
    : `Verwende den TM6 als einziges Kochgerät, außer der Wunsch impliziert eindeutig ein anderes Gerät. Falls doch nötig, sind nur diese Geräte vorhanden: ${opts.equipmentOwned.join(", ")}. Solche Schritte sind kind="off_device" mit gesetztem device. Kühlschrank/Gefrierschrank betreffen nur Lagerhinweise, nie Kochschritte.`;

  let prompt = `Du bist ein Experte für Thermomix-TM6-Rezepte. Erstelle ein vollständiges, alltagstaugliches Rezept auf Deutsch. Recherchiere zuerst mit der Websuche nach bewährten Rezepten und Garzeiten als Grundlage, übernimm aber nie Text wörtlich — formuliere eigenständig und passe alles an den TM6 an.

## TM6-Fähigkeiten (vollständig, nichts anderes existiert)
- Stufen: 0,5 bis 10 sowie Turbo. Teigstufe für Knetteig. Linkslauf (reverse) für schonendes Rühren.
- Temperaturen: 37–160 °C sowie Varoma-Stufe zum Dämpfen.
- Modi: Slow Cooking, Sous-vide, Fermentieren, Reiskocher, Wasserkocher, Eierkocher, Eindicken, Aufwärmen, Anbraten/Karamellisieren, Vorreinigen.
- Zubehör: Mixtopf (2,2 l), Varoma (Behälter + Einlegeboden), Gareinsatz, Rühraufsatz (Schmetterling), Spatel, ZWEI Messbecher, Gemüse-Styler. Es gibt KEIN weiteres Zubehör.

## Schritt-Regeln
- Jeder TM6-Schritt (kind="tm6") MUSS seconds, temp (oder null wenn ohne Heizen) und speed tragen — das ist die Notation "3 Min. / 100°C / Stufe 2".
- Schritte außerhalb der Maschine (kind="off_device") nennen ihr Gerät (device) und stehen in korrekter zeitlicher Reihenfolge zwischen den TM6-Schritten.
- ${geraeteRegel}

## Zutaten-Regeln
- Mengen in der kanonischen Dimension der Zutat: mass→g, volume→ml, count→Stück. Informelle Einheiten (Prise, TL, EL, Spritzer) nur für Gewürze/Kleinstmengen.
- Für count-Zutaten grams_per_piece schätzen (z. B. Zwiebel 90).
- scaling je Zutat: "linear" (Standard), "damped" (Salz, Chili, intensive Gewürze), "fixed" (z. B. Wasser für den Varoma-Tank, "1 Prise").
- Verwende für Zutaten, die in dieser Liste vorkommen, EXAKT den gelisteten Namen (Singular, Grundform): ${opts.canonicalNames.join(", ") || "(noch keine)"}
- Kategorien für neue Zutaten: Gemüse & Obst, Fleisch & Fisch, Milchprodukte, Grundnahrungsmittel, Gewürze, Tiefkühl, Getränke, Sonstiges.

## Ernährungsziel (Standard, außer der Wunsch sagt anderes)
${opts.dietBias}

Wenn das Rezept fertig durchdacht ist, gib es GENAU EINMAL über das Tool save_recipe aus.`;

  if (opts.pantry && opts.pantry.length > 0) {
    const lines = opts.pantry.map((p) => {
      if (p.amountless) return `- ${p.name}: immer da`;
      const unit = p.unit_dim === "mass" ? "g" : p.unit_dim === "volume" ? "ml" : "Stück";
      return `- ${p.name}: ${p.quantity} ${unit}`;
    });
    prompt += `\n\n## Vorrat des Nutzers\nFolgende Zutaten sind verfügbar:\n${lines.join("\n")}\n\nBevorzuge Zutaten aus dem Vorrat wenn möglich, aber schränke dich nicht darauf ein.\nWenn der Nutzer einen konkreten Wunsch hat, hat dieser Vorrang vor dem Vorrat.`;
  }

  return prompt;
}

export function buildImportPrompt(opts: {
  equipmentOwned: string[]; canonicalNames: string[];
  extraGeraeteErlaubt: boolean; pantry?: PantryPromptItem[];
}): string {
  const geraeteRegel = opts.extraGeraeteErlaubt
    ? `Zusätzlich zum TM6 dürfen verwendet werden: ${opts.equipmentOwned.join(", ")}.`
    : `Verwende den TM6 als einziges Kochgerät wenn möglich. Falls doch nötig: ${opts.equipmentOwned.join(", ")}.`;

  let prompt = `Du bist ein Experte für Thermomix-TM6-Rezepte. Deine Aufgabe ist es, ein vorgegebenes Rezept in ein TM6-optimiertes Rezept umzuwandeln.

## Anweisungen
- Bewahre die Identität des Gerichts — Name, Geschmack und Charakter sollen erhalten bleiben.
- Wandle Schritte in TM6-Schritte (kind="tm6") um wo der TM6 das zuverlässig und sinnvoll erledigen kann.
- Behalte Schritte als off_device bei, wo der TM6 nicht geeignet ist (Backofen, Grill, Pfanne für Röstaromen, etc.).
- ${geraeteRegel}
- Optimiere Garzeiten und Temperaturen für den TM6 wo möglich.
- Behalte Zutaten möglichst bei, passe Mengen an kanonische Einheiten an (g, ml, Stück).

## TM6-Fähigkeiten
- Stufen: 0,5 bis 10 sowie Turbo. Teigstufe für Knetteig. Linkslauf für schonendes Rühren.
- Temperaturen: 37–160 °C sowie Varoma-Stufe zum Dämpfen.
- Modi: Slow Cooking, Sous-vide, Fermentieren, Reiskocher, Wasserkocher, Eierkocher, Eindicken, Aufwärmen, Anbraten/Karamellisieren, Vorreinigen.
- Zubehör: Mixtopf (2,2 l), Varoma (Behälter + Einlegeboden), Gareinsatz, Rühraufsatz (Schmetterling), Spatel, ZWEI Messbecher, Gemüse-Styler.

## Zutaten-Regeln
- Mengen in der kanonischen Dimension: mass→g, volume→ml, count→Stück. Informelle Einheiten (Prise, TL, EL, Spritzer) nur für Gewürze/Kleinstmengen.
- Für count-Zutaten grams_per_piece schätzen.
- scaling: "linear" (Standard), "damped" (intensive Gewürze), "fixed" (z.B. Wasser für Varoma-Tank).
- Verwende für bekannte Zutaten EXAKT den gelisteten Namen: ${opts.canonicalNames.join(", ") || "(noch keine)"}
- Kategorien: Gemüse & Obst, Fleisch & Fisch, Milchprodukte, Grundnahrungsmittel, Gewürze, Tiefkühl, Getränke, Sonstiges.

Wenn das Rezept fertig umgewandelt ist, gib es GENAU EINMAL über das Tool save_recipe aus.`;

  if (opts.pantry && opts.pantry.length > 0) {
    const lines = opts.pantry.map((p) => {
      if (p.amountless) return `- ${p.name}: immer da`;
      const unit = p.unit_dim === "mass" ? "g" : p.unit_dim === "volume" ? "ml" : "Stück";
      return `- ${p.name}: ${p.quantity} ${unit}`;
    });
    prompt += `\n\n## Vorrat des Nutzers\n${lines.join("\n")}\n\nHinweis: Du kannst auf Substitutionsmöglichkeiten aus dem Vorrat hinweisen, aber verändere das Originalrezept nicht grundlegend.`;
  }

  return prompt;
}

export const UNITS = ["g", "ml", "Stück", "Prise", "TL", "EL", "Spritzer"];
const SPEEDS = ["0.5","1","1.5","2","2.5","3","3.5","4","4.5","5","5.5","6","6.5","7","7.5","8","8.5","9","9.5","10","Turbo","Teigstufe"];
const MODES = ["Slow Cooking","Sous-vide","Fermentieren","Reiskocher","Wasserkocher","Eierkocher","Eindicken","Aufwärmen","Anbraten/Karamellisieren","Vorreinigen"];
const ACCESSORIES = ["Varoma","Gareinsatz","Rühraufsatz","Gemüse-Styler","Messbecher"];
const CATEGORIES = ["Gemüse & Obst","Fleisch & Fisch","Milchprodukte","Grundnahrungsmittel","Gewürze","Tiefkühl","Getränke","Sonstiges"];

export const SAVE_RECIPE_TOOL = {
  name: "save_recipe",
  description: "Gib das fertige TM6-Rezept strukturiert aus.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["title","description","servings_base","total_time_min","active_time_min","tags","equipment","ingredients","steps"],
    properties: {
      title: { type: "string" },
      description: { type: ["string","null"], description: "1-2 Sätze Appetitmacher" },
      servings_base: { type: "integer" },
      total_time_min: { type: ["integer","null"] },
      active_time_min: { type: ["integer","null"] },
      tags: { type: "array", items: { type: "string" } },
      equipment: { type: "array", items: { type: "string" }, description: "Benötigte Geräte außer TM6 (aus off_device-Schritten)" },
      ingredients: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["name","category","unit_dim","grams_per_piece","quantity","unit","scaling","note","section"],
          properties: {
            name: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            unit_dim: { type: "string", enum: ["mass","volume","count"] },
            grams_per_piece: { type: ["number","null"] },
            quantity: { type: "number" },
            unit: { type: "string", enum: UNITS },
            scaling: { type: "string", enum: ["linear","damped","fixed"] },
            note: { type: ["string","null"] },
            section: { type: ["string","null"] },
          },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["kind","text","seconds","temp","speed","reverse","mode","accessory","device"],
          properties: {
            kind: { type: "string", enum: ["tm6","off_device"] },
            text: { type: "string" },
            seconds: { type: ["integer","null"] },
            temp: { type: ["string","null"], description: "37-160 oder 'Varoma', null = ohne Heizen" },
            // strict mode rejects enum on nullable union types — allowed values live in the description
            speed: { type: ["string","null"], description: `Erlaubte Werte: ${SPEEDS.join(", ")}. null bei off_device.` },
            reverse: { type: "boolean" },
            mode: { type: ["string","null"], description: `Erlaubte Werte: ${MODES.join(", ")}. Sonst null.` },
            accessory: { type: ["string","null"], description: `Erlaubte Werte: ${ACCESSORIES.join(", ")}. Sonst null.` },
            device: { type: ["string","null"] },
          },
        },
      },
    },
  },
} as const;
