/**
 * cpred-evasion-workflow - DV / hit helpers (runs on the attacker's client).
 *
 * Ported from diwako-cpred-additions/scripts/utils.js so this module can decide, on its own,
 * whether a RANGED shot actually HIT its DV before prompting the target. We deliberately keep
 * this self-contained (no import from diwako) so the module stays standalone.
 *
 * A shot HITS when the attack total is strictly greater than the DV (diwako treats
 * "dv >= attackRoll" as a miss, i.e. the DV wins ties). Melee is NOT resolved here - melee is
 * an opposed Evasion roll handled in resolve.js.
 */
import { LOG } from "./constants.js";

const DV_CACHE = new Map();

export class Utils {
  /**
   * Grid distance (in scene distance units) between two tokens, accounting for elevation.
   * Mirrors diwako's implementation; tolerant of a token id string or a Token/TokenDocument.
   * @param {TokenDocument|Token|string} token - the attacker token (or its id)
   * @param {Token|TokenDocument} target - the target token (placeable or document)
   * @returns {number} rounded distance, or NaN if it cannot be measured
   */
  static getDistance(token, target) {
    if (typeof token === "string") token = canvas.scene?.tokens.get(token);
    if (token?.document) token = token.document;
    if (!token || !target) return NaN;
    const targetDoc = target.document ?? target;
    try {
      const a = canvas.grid.measurePath([token, targetDoc]).cost;
      const b = (token.elevation ?? 0) - (targetDoc.elevation ?? 0);
      return Math.round(Math.sqrt(a * a + b * b));
    } catch (e) {
      console.warn(`${LOG} | getDistance failed`, e);
      return NaN;
    }
  }

  /**
   * Resolve the DV for a given DV table name at a given distance. Mirrors diwako: first an
   * imported RollTable of that name, then the system's configured DV compendium, then the
   * default internal pack. Results are cached. Returns -1 when the DV cannot be found.
   * @param {string} dvTable
   * @param {number} dist
   * @returns {Promise<number>} the DV, or -1 if unavailable
   */
  static async getDV(dvTable, dist) {
    if (!dvTable || dvTable === "" || Number.isNaN(dist)) return -1;
    let cachedData = DV_CACHE.get(dvTable);
    if (!cachedData) {
      let table = await game.tables.getName(dvTable);
      if (!table) {
        const compendium = game.settings.get(game.system.id, "dvRollTableCompendium");
        const pack =
          game.packs.get(compendium) ||
          game.packs.get(`${game.system.id}.internal_dv-tables`);
        if (!pack) return -1;
        const tableId = pack.index.getName(dvTable)?._id;
        if (!tableId) {
          console.log(`${LOG} | No compendium DV table found => ${dvTable}`);
          return -1;
        }
        table = await pack.getDocument(tableId);
      }
      cachedData = { table, dvs: new Map() };
      DV_CACHE.set(dvTable, cachedData);
    }
    let dv = cachedData.dvs.get(dist);
    if (dv === undefined) {
      const draw = await cachedData.table.getResultsForRoll(dist);
      if (!draw || draw.length === 0) {
        console.log(`${LOG} | Could not draw from DV table => ${cachedData.table.name}`);
        return -1;
      }
      dv = parseInt(draw[0].text, 10);
      cachedData.dvs.set(dist, dv);
    }
    return dv;
  }

  /**
   * Resolve the DV number for a RANGED attack (table lookup at the current distance).
   *
   * This is the primitive the BLIND-decision workflow needs: detect.js computes the DV on the
   * ATTACKER's client and ships it in the payload so the resolution can decide a Tank outcome
   * (hit/miss) WITHOUT the defender ever seeing hit/miss before choosing. It intentionally does
   * NOT compare against the attack total - that comparison happens later in resolve.js.
   *
   * @param {object} p
   * @param {TokenDocument|Token|string} p.atkToken - attacker token
   * @param {Token|TokenDocument} p.target - target token
   * @param {Item} p.weapon - the firing weapon item (uses weapon.system.dvTable)
   * @param {string} [p.subtitle] - the attack card subtitle (used to detect Autofire)
   * @returns {Promise<{dv: number|null}>} dv=null when it cannot be determined (no table,
   *   unmeasurable distance, or a missing DV entry).
   */
  static async getRangedDV({ atkToken, target, weapon, subtitle }) {
    let dvTable = weapon?.system?.dvTable;
    if (!dvTable || dvTable === "") return { dv: null };

    // Autofire uses a dedicated "<table> (Autofire)" DV table, matching diwako.
    if (subtitle && subtitle === game.i18n.localize("CPR.global.itemType.skill.autofire")) {
      dvTable = `${dvTable} (Autofire)`;
    }

    const dist = Utils.getDistance(atkToken, target);
    if (Number.isNaN(dist)) return { dv: null };

    const dv = await Utils.getDV(dvTable, dist);
    if (dv < 0) return { dv: null };
    return { dv };
  }

  /**
   * Decide whether a RANGED attack hits its DV. Now a thin wrapper over getRangedDV so the DV
   * logic lives in exactly one place. Kept for API/back-compat and used by the Tank resolution.
   * A shot HITS when the attack total is strictly greater than the DV (DV wins ties).
   * @param {object} p - as getRangedDV, plus:
   * @param {number} p.attackTotal - the attacker's final attack roll total
   * @returns {Promise<boolean|null>} true = hit, false = clean miss, null = DV undeterminable
   */
  static async isRangedHit(p) {
    const { dv } = await Utils.getRangedDV(p);
    if (dv == null) return null;
    return p.attackTotal > dv;
  }
}
