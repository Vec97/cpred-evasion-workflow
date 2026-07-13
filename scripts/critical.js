/**
 * cpred-evasion-workflow - critical-injury announcement (runs on the GM client).
 *
 * When an auto-rolled damage roll scores a Critical Injury (2+ sixes), roll the system's own
 * critical-injury RollTable for the hit location and POST which injury resulted. It is purely
 * informational: the injury is NOT added to the actor (the user applies it manually if they want).
 *
 * Table source mirrors the system: setting `criticalInjuryRollTableCompendium` (default compendium
 * "cyberpunk-red-core.internal_critical-injury-tables") which holds the RollTables "Critical
 * Injuries (Head)" and "Critical Injuries (Body)". The location picks head vs body.
 */
import { MODULE_ID, LOG } from "./constants.js";

/**
 * Roll a critical injury for the given hit location and post an informational chat card.
 * Best-effort: if the table cannot be read, posts an "unknown" note instead of throwing.
 * @param {object} p
 * @param {string} p.location "head" | "brain" | "body"
 * @param {string} p.targetName
 * @returns {Promise<void>}
 */
export async function announceCriticalInjury({ location, targetName }) {
  const wantHead = location === "head" || location === "brain";
  const locLabel = game.i18n.localize(`${MODULE_ID}.crit.${wantHead ? "head" : "body"}`);

  let injuryName = null;
  let rollTotal = null;
  try {
    const compId = game.settings.get(game.system.id, "criticalInjuryRollTableCompendium");
    const pack = compId ? game.packs.get(compId) : null;
    const tables = pack ? await pack.getDocuments() : [];
    if (tables.length) {
      const headTable = tables.find((t) => /head/i.test(t.name));
      const bodyTable = tables.find((t) => /body/i.test(t.name));
      const table =
        (wantHead ? headTable : bodyTable) ?? bodyTable ?? headTable ?? tables[0];
      if (table) {
        // displayChat:false -> the system's own draw card is suppressed; we post our own line.
        const draw = await table.draw({ displayChat: false });
        injuryName = draw?.results?.[0]?.text ?? draw?.results?.[0]?.name ?? null;
        rollTotal = draw?.roll?.total ?? null;
      }
    }
  } catch (e) {
    console.warn(`${LOG} | announceCriticalInjury: could not roll the critical injury table`, e);
  }

  let message;
  if (injuryName) {
    message = game.i18n.format(`${MODULE_ID}.crit.line`, {
      target: targetName,
      loc: locLabel,
      injury: `<span class="cpr-evw-crit-name">${injuryName}</span>`,
      roll: rollTotal ?? "?",
    });
  } else {
    message = game.i18n.format(`${MODULE_ID}.crit.unknown`, {
      target: targetName,
      loc: locLabel,
    });
  }

  // Flagged so this module's own detection hook ignores it.
  await ChatMessage.create({
    content: `<div class="cpr-evasion-crit">${message}</div>`,
    flags: { [MODULE_ID]: { crit: true } },
  });
}
