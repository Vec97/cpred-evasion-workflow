/**
 * cpred-evasion-workflow - shared cyberpunk-red-core deep-import shim.
 *
 * Both resolve.js (Evasion skill roll + skill card) and damage.js (weapon damage roll +
 * damage card) need the same two deep system imports:
 *   - rollTypes / CPRSkillRoll / CPRDamageRoll from /systems/<id>/modules/rolls/cpr-rolls.js
 *   - CPRChat (default export, static RenderRollCard) from .../modules/chat/cpr-chat.js
 *
 * To avoid duplicating the guarded import logic (and to have ONE place to update if a future
 * system version relocates these files) the imports live here and are re-exposed via small
 * accessor helpers. All lookups degrade gracefully (string/globalThis fallbacks) instead of
 * throwing, mirroring the original resolve.js behavior.
 *
 * VERIFIED against the installed cyberpunk-red-core build (module.json verified v0.92.4):
 *   - rollTypes.SKILL === "skill", rollTypes.DAMAGE === "damage"  (cpr-rolls.js)
 *   - CPRSkillRoll, CPRDamageRoll are NAMED exports of cpr-rolls.js
 *   - CPRChat is the DEFAULT export of cpr-chat.js; RenderRollCard(cprRoll) is static single-arg
 *   - weapon.createRoll(rollTypes.DAMAGE, actor) -> _createDamageRoll (cpr-item.js:428)
 */
import { LOG } from "./constants.js";

const SYSTEM_ID = game?.system?.id ?? "cyberpunk-red-core";

let CPRRolls = null;
let CPRChat = null;

// Candidate file locations, tried in order: current system id first, hard-coded id second.
const ROLLS_MODULE_PATHS = [
  `/systems/${SYSTEM_ID}/modules/rolls/cpr-rolls.js`,
  `/systems/cyberpunk-red-core/modules/rolls/cpr-rolls.js`,
];
const CHAT_MODULE_PATHS = [
  `/systems/${SYSTEM_ID}/modules/chat/cpr-chat.js`,
  `/systems/cyberpunk-red-core/modules/chat/cpr-chat.js`,
];

for (const p of ROLLS_MODULE_PATHS) {
  try {
    // eslint-disable-next-line no-await-in-loop, import/no-absolute-path
    CPRRolls = await import(p);
    if (CPRRolls) break;
  } catch (e) {
    console.warn(`${LOG} | could not import ${p}`, e);
  }
}
for (const p of CHAT_MODULE_PATHS) {
  try {
    // eslint-disable-next-line no-await-in-loop, import/no-absolute-path
    const chatMod = await import(p);
    CPRChat = chatMod?.default ?? chatMod?.CPRChat ?? null;
    if (CPRChat) break;
  } catch (e) {
    console.warn(`${LOG} | could not import ${p}`, e);
  }
}
if (!CPRChat && globalThis.CPRChat?.RenderRollCard) {
  CPRChat = globalThis.CPRChat;
}

if (!CPRRolls) {
  console.warn(`${LOG} | cpr-rolls.js could not be imported - falling back to string roll types.`);
}
if (!CPRChat) {
  console.warn(`${LOG} | cpr-chat.js could not be imported - roll cards will be skipped.`);
}

/** rollTypes.SKILL, resilient to a failed import. The string value is "skill". */
export function getSkillRollType() {
  return CPRRolls?.rollTypes?.SKILL ?? "skill";
}

/** rollTypes.DAMAGE, resilient to a failed import. The string value is "damage". */
export function getDamageRollType() {
  return CPRRolls?.rollTypes?.DAMAGE ?? "damage";
}

/** rollTypes.AIMED, resilient to a failed import. The string value is "aimed". */
export function getAimedRollType() {
  return CPRRolls?.rollTypes?.AIMED ?? "aimed";
}

/** rollTypes.AUTOFIRE, resilient to a failed import. The string value is "autofire". */
export function getAutofireRollType() {
  return CPRRolls?.rollTypes?.AUTOFIRE ?? "autofire";
}

/** The CPRSkillRoll class (used for the untrained-melee bare-stat defense), or null. */
export function getCPRSkillRoll() {
  return CPRRolls?.CPRSkillRoll ?? null;
}

/** CPRChat.RenderRollCard bound to CPRChat, or null if unavailable. */
export function getRenderRollCard() {
  if (CPRChat?.RenderRollCard) return CPRChat.RenderRollCard.bind(CPRChat);
  if (typeof globalThis.CPRChat?.RenderRollCard === "function") {
    return globalThis.CPRChat.RenderRollCard.bind(globalThis.CPRChat);
  }
  return null;
}
