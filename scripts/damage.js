/**
 * cpred-evasion-workflow - auto weapon damage roll + application (runs on a GM client).
 *
 * onDamageRequest is registered as the socketlib function "handleDamage" and is ALWAYS invoked
 * via Sockets.executeGMDamage -> socket.executeAsGM(...). It therefore runs on the (single) GM
 * client, which has the rights needed to (a) read the attacker actor/weapon and (b) mutate the
 * TARGET actor's HP + ablate its armor via the system's own damage pipeline. Players cannot do
 * either, which is why this whole step is GM-routed.
 *
 * We NEVER reimplement armor/HP math: we roll the weapon's damage with the system roll pipeline,
 * render the standard damage card (so the table sees the dice), then call the actor's own
 * _applyDamage with the same argument shape the system uses at its own call site
 * (cpr-chat.js:547 -> cpr-actor.js:1299). VERIFIED against the installed build.
 *
 * Grenades/rockets/thrown and autofire/aimed shots are excluded UPSTREAM (detect.js computes
 * damageEligible); this handler assumes a basic single-shot ranged or a melee weapon and rolls a
 * plain DAMAGE roll (never AIMED/AUTOFIRE), so location stays "body".
 *
 * Return contract: { applied:boolean, total?:number, bonus?:number, critical?:boolean,
 *                    location?:string, reason?:string }. applied:false (or a thrown/rejected
 *  executeAsGM) makes the caller fall back to the "attacker rolls damage manually" result card.
 */
import { LOG } from "./constants.js";
import { getDamageRollType, getRenderRollCard } from "./cprSystem.js";

/**
 * Roll + apply the attacker's weapon damage to the target. Runs on the GM client.
 * @param {object} payload
 * @param {string} payload.attackerActorId
 * @param {string|null} payload.attackerTokenId
 * @param {string|null} payload.attackerSceneId
 * @param {string} payload.weaponId
 * @param {string} payload.defActorId
 * @param {string|null} payload.defTokenId
 * @param {string|null} payload.defSceneId
 * @returns {Promise<object>} see return contract above
 */
export async function onDamageRequest(payload) {
  console.log(`${LOG} | onDamageRequest (GM)`, payload);
  const {
    attackerActorId,
    attackerTokenId,
    attackerSceneId,
    weaponId,
    defActorId,
    defTokenId,
    defSceneId,
  } = payload;

  // (1) Resolve the ATTACKER actor (token-first so unlinked tokens use their own actor).
  const atkScene = attackerSceneId ? game.scenes.get(attackerSceneId) : canvas.scene;
  const atkTokenDoc = attackerTokenId ? atkScene?.tokens?.get(attackerTokenId) : null;
  const atkActor = atkTokenDoc?.actor ?? game.actors.get(attackerActorId);
  if (!atkActor) {
    console.warn(`${LOG} | onDamageRequest: attacker actor not found`, payload);
    return { applied: false, reason: "noAttacker" };
  }

  // (2) Resolve the fired weapon item on the attacker.
  const weapon = atkActor.items.get(weaponId);
  if (!weapon) {
    console.warn(`${LOG} | onDamageRequest: weapon item not found`, payload);
    return { applied: false, reason: "noWeapon" };
  }

  // (3) Resolve the TARGET actor (token-first).
  const defScene = defSceneId ? game.scenes.get(defSceneId) : canvas.scene;
  const defTokenDoc = defTokenId ? defScene?.tokens?.get(defTokenId) : null;
  const targetActor = defTokenDoc?.actor ?? game.actors.get(defActorId);
  if (!targetActor) {
    console.warn(`${LOG} | onDamageRequest: target actor not found`, payload);
    return { applied: false, reason: "noTarget" };
  }

  // (4) Build + roll the weapon damage through the system pipeline (plain DAMAGE roll).
  const dmg = weapon.createRoll(getDamageRollType(), atkActor);
  if (!dmg) {
    console.warn(`${LOG} | onDamageRequest: weapon.createRoll(DAMAGE) returned null`, payload);
    return { applied: false, reason: "noRoll" };
  }
  await dmg.roll();

  // (5) Render the standard damage card so everyone sees the dice (speaker = attacker).
  dmg.entityData = { actor: atkActor.id, token: attackerTokenId ?? null, tokens: [] };
  const render = getRenderRollCard();
  if (render) {
    try {
      await render(dmg);
    } catch (e) {
      console.warn(`${LOG} | onDamageRequest: RenderRollCard(damage) failed - continuing to apply`, e);
    }
  } else {
    console.warn(`${LOG} | onDamageRequest: RenderRollCard unavailable - skipping damage card`);
  }

  // (6) Extract the values _applyDamage needs (verified against cpr-damage-rollcard.hbs +
  //     CPRDamageRoll in cpr-rolls.js). We roll plain damage, so isAimed is false -> body.
  const totalDamage = dmg.resultTotal;
  const criticalCard =
    typeof dmg.wasCritSuccess === "function"
      ? dmg.wasCritSuccess()
      : dmg.faces.filter((f) => f === 6).length >= 2; // 2+ sixes
  const bonusDamage = criticalCard ? dmg.bonusDamage ?? 5 : 0;
  const location = dmg.isAimed ? dmg.location : "body";
  const ea = dmg.rollCardExtraArgs ?? {};
  const damageLethal = ea.ammoType !== "rubber";
  const ablation = ea.ablationValue ?? 1;
  const ammoVariety = ea.ammoVariety;
  const ignoreArmorPercent = ea.ignoreArmorPercent ?? 0;
  const ignoreBelowSP = ea.ignoreBelowSP ?? 0;
  const dialogData = {
    damageReductionRole: true,
    damageReductionAE: true,
    useShield: true,
    brainDamageReduction: true,
  };

  // (7) Apply via the actor's OWN pipeline (armor ablation + HP update). GM-only mutation.
  try {
    await targetActor._applyDamage(
      totalDamage,
      bonusDamage,
      location,
      ablation,
      ammoVariety,
      ignoreArmorPercent,
      ignoreBelowSP,
      damageLethal,
      dialogData
    );
  } catch (e) {
    console.warn(`${LOG} | onDamageRequest: _applyDamage failed`, e);
    return { applied: false, reason: "applyFailed", total: totalDamage };
  }

  console.log(
    `${LOG} | onDamageRequest: applied ${totalDamage} (+${bonusDamage} crit) to ${targetActor.name} @ ${location}`
  );
  return {
    applied: true,
    total: totalDamage,
    bonus: bonusDamage,
    critical: criticalCard,
    location,
  };
}
