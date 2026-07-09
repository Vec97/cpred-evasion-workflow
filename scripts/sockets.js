/**
 * cpred-evasion-workflow - socketlib wrapper + cross-client routing.
 *
 * socketlib is a HARD dependency (module.json requires). The melee auto-path has no
 * user click to piggyback on, so the Evasion roll MUST run on a specific target-owning
 * client. socketlib.executeAsUser guarantees exactly one receiver.
 *
 * Registered functions run on the RECEIVER:
 *   handlePrompt -> prompt.js onPrompt   (defender's responsible user)
 *   handleMelee  -> prompt.js onMelee    (defender's responsible user)
 *   handleDamage -> damage.js onDamageRequest (executed on a GM client via executeAsGM)
 *
 * Emits run on the ATTACKER's client (prompt/melee, from detect.js) or on the DEFENDER's
 * client (damage, from resolve.js after a confirmed hit).
 *
 * handleDamage is GM-routed because it mutates the TARGET actor (HP + armor ablation) and reads
 * the attacker actor/weapon - neither of which a player client is allowed to do.
 *
 * NOTE: socketlib.registerModule() requires "socket": true in module.json. If that flag
 * is absent, registerModule() logs an error and returns undefined; register() below bails
 * loudly in that case instead of throwing later on .register()/.executeAsUser().
 */
import { MODULE_ID, LOG } from "./constants.js";
import { onPrompt, onMelee } from "./prompt.js";
import { onDamageRequest } from "./damage.js";

export class Sockets {
  static socket = null;

  static register() {
    // socketlib is a global provided by the socketlib module.
    // eslint-disable-next-line no-undef
    Sockets.socket = socketlib.registerModule(MODULE_ID);
    // If "socket": true is missing from module.json, registerModule returns undefined.
    // Degrade gracefully (loud notice) instead of throwing on .register().
    if (!Sockets.socket) {
      console.error(
        `${LOG} | socketlib.registerModule returned undefined. Ensure "socket": true is set in module.json, then restart Foundry and reload the world.`
      );
      ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.error.noSocketFlag`));
      return;
    }
    Sockets.socket.register("handlePrompt", onPrompt);
    Sockets.socket.register("handleMelee", onMelee);
    Sockets.socket.register("handleDamage", onDamageRequest);
    console.log(`${LOG} | socket registered (handlePrompt, handleMelee, handleDamage)`);
  }

  /**
   * Determine the single responsible user for a defender actor.
   * - Active, non-GM users who OWN the actor, lowest userId => that player.
   * - Otherwise (owner-less NPC): lowest-userId active GM (single-responsible-GM guard).
   * @param {Actor} defActor
   * @param {string|null} [excludeUserId] optionally skip a user (e.g. one that just went offline)
   * @returns {string|null} userId or null if nobody qualifies
   */
  static resolveResponsibleUser(defActor, excludeUserId = null) {
    const owners = game.users.filter(
      (u) =>
        u.active &&
        !u.isGM &&
        u.id !== excludeUserId &&
        defActor.testUserPermission(u, "OWNER")
    );
    if (owners.length > 0) {
      owners.sort((a, b) => a.id.localeCompare(b.id));
      return owners[0].id;
    }
    const gms = game.users.filter(
      (u) => u.active && u.isGM && u.id !== excludeUserId
    );
    if (gms.length > 0) {
      gms.sort((a, b) => a.id.localeCompare(b.id));
      return gms[0].id;
    }
    return null;
  }

  /** Emit a RANGED prompt request to the defender's responsible user. */
  static async emitPrompt(defenderUserId, payload) {
    console.log(`${LOG} | emitPrompt -> user ${defenderUserId}`, payload);
    return Sockets.socket.executeAsUser("handlePrompt", defenderUserId, payload);
  }

  /** Emit a MELEE auto-resolve request to the defender's responsible user. */
  static async emitMelee(defenderUserId, payload) {
    console.log(`${LOG} | emitMelee -> user ${defenderUserId}`, payload);
    return Sockets.socket.executeAsUser("handleMelee", defenderUserId, payload);
  }

  /**
   * Run the auto weapon-damage roll + application on a GM client.
   * Rejects (SocketlibNoGMConnectedError) if no GM is connected - the caller catches this and
   * falls back to the "attacker rolls damage manually" result card.
   * @param {object} payload see damage.js onDamageRequest
   * @returns {Promise<object>} the handler's return object ({applied, total, ...})
   */
  static async executeGMDamage(payload) {
    console.log(`${LOG} | executeGMDamage -> GM`, payload);
    return Sockets.socket.executeAsGM("handleDamage", payload);
  }
}
