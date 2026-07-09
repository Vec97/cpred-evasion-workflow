/**
 * cpred-evasion-workflow - headless Evasion roll + result card (runs on the DEFENDER's client).
 *
 * resolveEvasion: locate the Evasion skill item by its CANONICAL ENGLISH NAME ("Evasion"),
 * build the roll via the skill item's own createRoll (so DEX + level + wound/armor/role/AE
 * mods are auto-included), roll headlessly (NO handleRollDialog -> no verify dialog), read
 * resultTotal, render the standard CPR skill card, and compute dodged per the tie setting.
 *
 * If the actor has NO Evasion skill item and untrained:true is passed (melee path), fall
 * back to a bare DEX+d10 opposed check (Evasion level 0) via a transient CPRSkillRoll, since
 * in CP:R melee is always opposed and untrained defenders still roll their governing stat.
 *
 * postResult: post ONE flagged result card. Created here (defender client) and natively
 * broadcast by Foundry to all clients. For a HIT (KIND in HIT_KINDS) it FIRST runs the optional
 * auto-damage step (GM-routed via socketlib) and then appends the appropriate damage sentence
 * (auto-applied vs "roll manually") to the result text.
 *
 * The deep system imports (rollTypes / CPRSkillRoll / CPRChat) live in cprSystem.js so this file
 * and damage.js share one guarded copy.
 */
import { MODULE_ID, LOG, KIND, HIT_KINDS, EVASION_SKILL_NAME } from "./constants.js";
import { Settings } from "./settings.js";
import { getSkillRollType, getCPRSkillRoll, getRenderRollCard } from "./cprSystem.js";

/**
 * Discover Evasion's governing stat (e.g. "ref" or "dex", per the system's skill definition)
 * from any Evasion skill item in the world, so the untrained-melee fallback never hardcodes the
 * wrong stat for an actor that happens to lack the skill item. Defaults to "ref" if no Evasion
 * skill exists anywhere.
 * @returns {string} the stat key
 */
function findEvasionStat() {
  const fromWorldItem = game.items?.find(
    (i) => i.type === "skill" && i.name === EVASION_SKILL_NAME
  );
  if (fromWorldItem?.system?.stat) return fromWorldItem.system.stat;
  for (const a of game.actors ?? []) {
    const s = a.itemTypes?.skill?.find((sk) => sk.name === EVASION_SKILL_NAME);
    if (s?.system?.stat) return s.system.stat;
  }
  return "ref";
}

/**
 * Roll the defender's Evasion and compare against the attack total.
 * @param {object} payload {defActorId, defTokenId, defSceneId, attackTotal, untrained?, ...}
 * @returns {Promise<{evasionTotal:number, dodged:boolean, ok:boolean, untrainedDefense?:boolean}>}
 */
export async function resolveEvasion(payload) {
  const { defActorId, defTokenId, defSceneId, attackTotal, untrained } = payload;

  const scene = defSceneId ? game.scenes.get(defSceneId) : canvas.scene;
  const defToken = scene?.tokens?.get(defTokenId) ?? null;
  const defActor = defToken?.actor ?? game.actors.get(defActorId);

  if (!defActor) {
    console.warn(`${LOG} | resolveEvasion: defender actor not found`, payload);
    return { evasionTotal: 0, dodged: false, ok: false };
  }

  // Locate the Evasion skill by CANONICAL ENGLISH NAME. Core skill items are always named
  // with the fixed English name; the localized label is derived from it at display time.
  // A localized-name lookup would fail on a German client (item is "Evasion", localize
  // returns "Ausweichen") and silently break every resolution. Localized fallback kept only
  // for the pathological case of a renamed item.
  let evasion = defActor.itemTypes.skill.find((s) => s.name === EVASION_SKILL_NAME);
  if (!evasion) {
    const localizedName = game.i18n.localize("CPR.global.itemType.skill.evasion");
    evasion = defActor.itemTypes.skill.find((s) => s.name === localizedName);
  }

  let cprRoll;
  let untrainedDefense = false;

  if (evasion) {
    // Build the roll via the skill item's own createRoll (auto-includes stat + mods).
    // Headless: we deliberately DO NOT call cprRoll.handleRollDialog() (the verify dialog).
    cprRoll = evasion.createRoll(getSkillRollType(), defActor);
  } else if (untrained) {
    // Untrained melee defense: bare governing-stat + d10, Evasion level 0. Build a transient
    // CPRSkillRoll(statName, statValue, skillName, skillValue) so the standard skill card still
    // renders "Evasion" and the total includes the stat. The stat is discovered generically
    // (never hardcoded REF vs DEX) since this actor has no Evasion item to read it from.
    const CPRSkillRoll = getCPRSkillRoll();
    const statName = findEvasionStat();
    const statValue =
      typeof defActor.getStat === "function"
        ? defActor.getStat(statName)
        : parseInt(defActor.system?.stats?.[statName]?.value ?? 0, 10);
    if (!CPRSkillRoll || Number.isNaN(statValue)) {
      console.warn(
        `${LOG} | resolveEvasion: cannot build untrained melee defense (missing CPRSkillRoll or ${statName})`,
        payload
      );
      return { evasionTotal: 0, dodged: false, ok: false };
    }
    cprRoll = new CPRSkillRoll(statName, statValue, EVASION_SKILL_NAME, 0);
    untrainedDefense = true;
  } else {
    // Ranged Evade with no skill item (should be gated by canEvadeRanged upstream).
    console.warn(
      `${LOG} | ${game.i18n.format(`${MODULE_ID}.error.noEvasionSkill`, { target: defActor.name })}`
    );
    return { evasionTotal: 0, dodged: false, ok: false };
  }

  await cprRoll.roll();
  const evasionTotal = cprRoll.resultTotal;

  // Speaker resolution for the standard skill card.
  cprRoll.entityData = {
    actor: defActor.id,
    token: defToken ? defToken.id : null,
    tokens: [],
    item: evasion ? evasion.id : null,
  };

  const render = getRenderRollCard();
  if (render) {
    await render(cprRoll);
  } else {
    console.warn(`${LOG} | RenderRollCard unavailable - skipping standard skill card render`);
  }

  const tie = Settings.get("tieGoesToDefender");
  const dodged = tie ? evasionTotal >= attackTotal : evasionTotal > attackTotal;

  return { evasionTotal, dodged, ok: true, untrainedDefense };
}

/**
 * Optional auto-damage step. Runs (on a GM client, via socketlib) only when the autoDamage
 * setting is on AND the shot was flagged damageEligible upstream. Returns the GM handler's
 * result ({applied, total, ...}) on success, or null so the caller uses the manual wording.
 * A rejected executeAsGM (no active GM) is caught and also yields null.
 * @param {object} ctx the result context (carries attacker/weapon/target ids + damageEligible)
 * @returns {Promise<object|null>}
 */
async function maybeApplyDamage(ctx) {
  if (!Settings.get("autoDamage")) return null;
  if (!ctx.damageEligible) return null;

  // Dynamic import avoids a static import cycle (sockets.js -> prompt.js -> resolve.js).
  const { Sockets } = await import("./sockets.js");
  try {
    const res = await Sockets.executeGMDamage({
      requestId: ctx.requestId,
      attackerActorId: ctx.attackerActorId,
      attackerTokenId: ctx.attackerTokenId,
      attackerSceneId: ctx.attackerSceneId,
      weaponId: ctx.weaponId,
      defActorId: ctx.defActorId,
      defTokenId: ctx.defTokenId,
      defSceneId: ctx.defSceneId,
      aimed: ctx.aimed,
    });
    if (res && res.applied) return res;
    console.warn(`${LOG} | auto-damage not applied (falling back to manual)`, res);
    return null;
  } catch (e) {
    console.warn(`${LOG} | executeGMDamage failed (no active GM?) - manual damage fallback`, e);
    return null;
  }
}

/**
 * Post ONE flagged result card. Created on the defender client and broadcast natively.
 * For a HIT kind it first runs the optional auto-damage step and appends the matching damage
 * sentence.
 * @param {string} kind one of KIND.*
 * @param {object} ctx {requestId, atkName, defName, evasionTotal, attackTotal, dv?, noSkill?,
 *                      untrainedDefense?, attackerUserId?, defActorId?, defTokenId?, defSceneId?,
 *                      damageEligible?, attackerActorId?, attackerTokenId?, attackerSceneId?, weaponId?}
 */
export async function postResult(kind, ctx) {
  const {
    requestId,
    atkName,
    defName,
    evasionTotal,
    attackTotal,
    noSkill,
    untrainedDefense,
  } = ctx;

  const stateClass =
    {
      [KIND.DODGED]: "dodged",
      [KIND.FAILED]: "hit",
      [KIND.TANKED]: "tanked",
      [KIND.MISSED_ANYWAY]: "dodged",
      [KIND.MELEE_DODGED]: "dodged",
      [KIND.MELEE_HIT]: "hit",
    }[kind] ?? "tanked";

  // Confirmed hit -> run the optional auto-damage step BEFORE composing the text so the card can
  // state the applied total. dodged/missed kinds never reach this.
  const isHit = HIT_KINDS.has(kind);
  const damage = isHit ? await maybeApplyDamage(ctx) : null;

  // Base sentence.
  let message;
  if (noSkill) {
    // "no usable Evasion" narrative (used for a hit the defender could not roll against).
    message = game.i18n.format(`${MODULE_ID}.error.noEvasionSkill`, { target: defName });
  } else {
    const untrainedKey = `${kind}Untrained`;
    const useUntrained =
      untrainedDefense && game.i18n.has(`${MODULE_ID}.result.${untrainedKey}`);
    const resolvedKey = useUntrained ? untrainedKey : kind;
    message = game.i18n.format(`${MODULE_ID}.result.${resolvedKey}`, {
      attacker: atkName,
      target: defName,
      evasion: evasionTotal ?? 0,
      attack: attackTotal ?? 0,
      dv: ctx.dv ?? 0,
    });
  }

  // Damage sentence (hit kinds only): auto-applied total vs "roll manually".
  if (isHit) {
    if (damage && damage.applied) {
      message += ` ${game.i18n.format(`${MODULE_ID}.result.damageAuto`, {
        damage: damage.total ?? 0,
      })}`;
    } else {
      message += ` ${game.i18n.localize(`${MODULE_ID}.result.damageManual`)}`;
    }
  }

  const content = `<div class="cpr-evasion-result ${stateClass}">${message}</div>`;

  const chatData = {
    content,
    speaker: { alias: defName },
    flags: { [MODULE_ID]: { result: true, requestId } },
  };

  const whisperMode = Settings.get("whisperResult");
  if (whisperMode === "gm") {
    chatData.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  } else if (whisperMode === "both") {
    // GM + everyone involved in the attack: the GM(s), this defender client, every active
    // OWNER of the defender actor (co-owners), and the ATTACKER user (carried in the payload
    // as attackerUserId - postResult runs on the defender, so game.userId is NOT the attacker).
    const involved = new Set(
      ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
    );
    involved.add(game.userId);
    if (ctx.attackerUserId) involved.add(ctx.attackerUserId);

    // Add active owners of the defender actor so a co-owner also sees the result.
    const scene = ctx.defSceneId ? game.scenes.get(ctx.defSceneId) : canvas.scene;
    const defToken = scene?.tokens?.get(ctx.defTokenId) ?? null;
    const defActor = defToken?.actor ?? game.actors.get(ctx.defActorId);
    if (defActor) {
      for (const u of game.users) {
        if (u.active && defActor.testUserPermission(u, "OWNER")) involved.add(u.id);
      }
    }
    chatData.whisper = Array.from(involved);
  }
  // 'public' -> no whisper key (visible to all).

  await ChatMessage.create(chatData);
}
