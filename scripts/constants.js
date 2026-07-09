/**
 * cpred-evasion-workflow - shared constants.
 */
export const MODULE_ID = "cpred-evasion-workflow";

// Console log tag (diwako-style module tag).
export const LOG = "cpred-evasion-workflow";

// Canonical (English) name of the Evasion skill item in cyberpunk-red-core.
// Core skill ITEMS are always named with their fixed English canonical name; the
// localized label (e.g. German "Ausweichen") is only derived FROM this name at display
// time via SystemUtils.slugify. NEVER look the item up by the localized string.
export const EVASION_SKILL_NAME = "Evasion";

// Result-card kinds.
export const KIND = {
  DODGED: "dodged",
  FAILED: "failed",
  TANKED: "tanked",
  MISSED_ANYWAY: "missedAnyway",
  MELEE_DODGED: "meleeDodged",
  MELEE_HIT: "meleeHit",
};

// Kinds that represent a confirmed HIT (they trigger the optional auto-damage step).
export const HIT_KINDS = new Set([KIND.FAILED, KIND.TANKED, KIND.MELEE_HIT]);
