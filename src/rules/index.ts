import { bannedSymbolsRule } from "./bannedSymbols.ts";
import { layerBoundariesRule } from "./layerBoundaries.ts";
import { maxFileLinesRule } from "./maxFileLines.ts";
import { requiredCompanionRule } from "./requiredCompanion.ts";
import type { Rule } from "../types.ts";

/** Every rule keelson knows about, keyed by the `id` used in keelson.yaml. */
export const RULES: ReadonlyMap<string, Rule<never>> = new Map(
  [maxFileLinesRule, bannedSymbolsRule, layerBoundariesRule, requiredCompanionRule].map((rule) => [
    rule.id,
    rule as Rule<never>,
  ]),
);

export const RULE_IDS: readonly string[] = [...RULES.keys()];
