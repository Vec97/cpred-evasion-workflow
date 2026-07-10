/**
 * cpred-evasion-workflow - attack detection (runs ONLY on the attacker's client).
 *
 * Mirrors diwako's robust DOM scrape (verified against the installed cyberpunk-red-core
 * v0.89 build): the system posts attack cards as pure HTML with NO flags and NO
 * message.rolls, so the attack total must be scraped from the DOM. The melee/ranged
 * discriminator is read off the WEAPON ITEM, not the DOM subtitle.
 */
import { MODULE_ID, LOG, EVASION_SKILL_NAME } from "./constants.js";
import { Settings } from "./settings.js";
import { Sockets } from "./sockets.js";
import { Utils } from "./utils.js";

export async function onCreateChatMessage(message) {
  // (1) Run only on the acting (attacker's) client. Guarantees single run.
  if (game.userId != message._source.author) return;

  // (2) Idempotency: skip our own prompt / result / skill / damage cards (they carry our flag).
  if (message.flags?.[MODULE_ID]) return;

  // (3) Build a DOM tree from the card content.
  const DIV = document.createElement("DIV");
  DIV.innerHTML = message.content;

  // (4) Require an attack card: the rollDamage tooltip AND the rollDamage dataset.
  //     (Plain damage cards have no toggleVisibility total span; this also excludes them.)
  const isAttack = DIV.querySelector(
    `[data-tooltip='${game.i18n.localize("CPR.actorSheets.commonActions.rollDamage")}']`
  );
  const data = DIV.querySelector("[data-action=rollDamage]")?.dataset;
  if (!isAttack || !data) return;

  // (5) Exclude suppressive fire (no single defender). Its card DOES carry a rollDamage
  //     button, so the subtitle text is the only reliable exclusion. Autofire/aimed pass.
  const subtitle = DIV.querySelector("div.rollcard-subtitle-center.text-small")?.innerHTML?.trim();
  if (subtitle === game.i18n.localize("CPR.rolls.suppressiveFire")) return;

  // (6) Targets: process EVERY targeted token as its own workflow (multi-target support). Each
  //     target gets its own DV, responsible user and requestId; the shared attack roll is compared
  //     against each. Normal single-target play is simply a one-element loop.
  const targets = Array.from(message.author.targets ?? []);
  if (targets.length === 0) {
    if (Settings.get("logMissingTarget")) {
      console.log(`${LOG} | ${game.i18n.localize(`${MODULE_ID}.error.noTarget`)}`);
    }
    return;
  }

  // (7) Resolve attacker token/actor/weapon exactly as diwako (shared across all targets).
  let atkToken =
    message.speaker?.token ||
    canvas.scene.tokens.get(data.tokenId) ||
    canvas.scene.tokens.getName(message.speaker?.alias);
  const atkActor = atkToken?.actor ?? game.actors.get(data.actorId);
  if (atkActor && !atkToken) {
    atkToken = canvas.scene.tokens.getName(atkActor.prototypeToken.name);
  }
  if (!atkActor) return;
  const weapon = atkActor.items.get(data.itemId);
  if (!weapon) return;

  // (8) Scrape the shared attack total (only source - the system sets no flags/rolls).
  const totalSpan = DIV.querySelector("span.clickable[data-action='toggleVisibility']");
  const attackTotal = parseInt(totalSpan?.innerHTML, 10);
  if (Number.isNaN(attackTotal)) return;

  // (9) Shared, per-attack facts (independent of which token is targeted).
  const isRangedPrompt =
    weapon.system.isRanged && weapon.system.weaponType !== "thrownWeapon";
  const atkTokenDoc =
    canvas.scene?.tokens.get(data.tokenId) ??
    (typeof message.speaker?.token === "string"
      ? canvas.scene?.tokens.get(message.speaker.token)
      : null) ??
    (atkActor ? canvas.scene?.tokens.getName(atkActor.prototypeToken.name) : null);
  const damageEligible = computeDamageEligible(weapon);
  const aimed = subtitle === game.i18n.localize("CPR.rolls.aimedShot");
  const autofire = subtitle === game.i18n.localize("CPR.global.itemType.skill.autofire");
  const atkName = atkToken?.name ?? atkActor.name;

  const shared = {
    message,
    subtitle,
    atkActor,
    atkTokenDoc,
    weapon,
    attackTotal,
    isRangedPrompt,
    damageEligible,
    aimed,
    autofire,
    atkName,
  };

  // (10) Run the Evade/Tank (or auto-melee) workflow once per targeted token.
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    await resolveTargetWorkflow(target, shared);
  }
}

/**
 * Run the evade/tank (ranged) or auto-melee workflow for ONE targeted token against the shared
 * attack. Computes the target-specific DV (for the blind Tank resolution and the autofire
 * multiplier), the responsible user, and a per-target requestId, then routes it via socketlib.
 * @param {Token} target the targeted token placeable
 * @param {object} shared per-attack facts from onCreateChatMessage
 */
async function resolveTargetWorkflow(target, shared) {
  const {
    message,
    subtitle,
    atkActor,
    atkTokenDoc,
    weapon,
    attackTotal,
    isRangedPrompt,
    damageEligible,
    aimed,
    autofire,
    atkName,
  } = shared;

  const defToken = target.document;
  const defActor = defToken?.actor;
  if (!defActor) return;

  // BLIND DECISION: compute the DV on the attacker client and ship it in the payload so the Tank
  // resolution can decide hit/miss WITHOUT the defender seeing it first. Melee needs no DV.
  // dv=null => undeterminable (Tank then counts as a hit so a shot is never silently eaten).
  let dv = null;
  if (isRangedPrompt) {
    dv = (await Utils.getRangedDV({ atkToken: atkTokenDoc, target, weapon, subtitle })).dv;
  }
  // Autofire damage multiplier = how much the attack beat the (autofire) DV by, min 1; null when
  // the DV is unknown (damage.js then falls back to a manual damage roll for autofire).
  const autofireMult = autofire && dv != null ? Math.max(1, attackTotal - dv) : null;

  // Per-target one-shot key: one attack message x one target => one workflow.
  const requestId = `${message.id}-${defToken.id}`;
  const defenderUserId = Sockets.resolveResponsibleUser(defActor);
  const defName = defToken.name ?? defActor.name;

  const basePayload = {
    requestId,
    attackTotal,
    defActorId: defActor.id,
    defTokenId: defToken.id,
    defSceneId: defToken.parent?.id ?? canvas.scene?.id,
    atkName,
    defName,
    // Attacker identity carried so the result card ('both' visibility) can whisper the
    // attacking player their own dodge/hit result (postResult runs on the DEFENDER client).
    attackerUserId: message._source.author,
    // Attacker identity for the GM auto-damage step (roll the fired weapon on the GM client).
    attackerActorId: atkActor.id,
    attackerTokenId: atkTokenDoc?.id ?? null,
    attackerSceneId: atkTokenDoc?.parent?.id ?? canvas.scene?.id,
    weaponId: weapon.id,
    // Whether auto-damage may run (still gated by the autoDamage setting + an active GM).
    damageEligible,
    // Fire mode -> the GM damage step rolls an aimed (located) or autofire (x multiplier) roll.
    aimed,
    autofire,
    autofireMult,
  };

  // Local (this-client) GM resolution helper, reused by the no-user and emit-failure paths.
  const resolveLocallyAsGM = async () => {
    const { onMelee, onPrompt } = await import("./prompt.js");
    if (isRangedPrompt && Settings.get("enableRangedPrompt")) {
      const canEvadeRanged = computeCanEvadeRanged(defActor);
      return onPrompt({ ...basePayload, canEvadeRanged, isMelee: false, dv });
    }
    if (Settings.get("enableAutoMelee")) {
      return onMelee({ ...basePayload, isMelee: true });
    }
    return undefined;
  };

  // No authoritative client available at selection time.
  if (!defenderUserId) {
    // Fall back to resolving locally ONLY if this attacker client is a GM.
    if (game.user.isGM) {
      console.warn(
        `${LOG} | ${game.i18n.localize(`${MODULE_ID}.error.noResponsibleUser`)} - resolving locally as GM.`
      );
      return resolveLocallyAsGM();
    }
    console.warn(`${LOG} | ${game.i18n.localize(`${MODULE_ID}.error.noResponsibleUser`)}`);
    return;
  }

  // RANGED path (prompt).
  if (isRangedPrompt) {
    if (!Settings.get("enableRangedPrompt")) return;
    const canEvadeRanged = computeCanEvadeRanged(defActor);
    try {
      await Sockets.emitPrompt(defenderUserId, {
        ...basePayload,
        canEvadeRanged,
        isMelee: false,
        dv,
      });
    } catch (e) {
      await handleEmitFailure(e, { defActor, resolveLocallyAsGM });
    }
    return;
  }

  // MELEE path (incl. thrownWeapon). No prompt.
  if (!Settings.get("enableAutoMelee")) return;
  try {
    await Sockets.emitMelee(defenderUserId, { ...basePayload, isMelee: true });
  } catch (e) {
    await handleEmitFailure(e, { defActor, resolveLocallyAsGM });
  }
}

/**
 * TOCTOU / socket-failure fallback for the awaited emits.
 * If the responsible user disconnected between selection and delivery, socketlib rejects
 * with SocketlibInvalidUserError. We degrade instead of leaving an unhandled rejection:
 *   - if this attacker client is a GM, resolve the workflow locally;
 *   - otherwise, post a visible notice so the table knows the defender must resolve manually.
 */
async function handleEmitFailure(error, { defActor, resolveLocallyAsGM }) {
  console.warn(`${LOG} | emit failed (responsible user likely offline)`, error);
  if (game.user.isGM) {
    console.warn(`${LOG} | falling back to local GM resolution.`);
    return resolveLocallyAsGM();
  }
  ui.notifications?.warn(
    game.i18n.format(`${MODULE_ID}.error.emitFailed`, { target: defActor?.name ?? "?" })
  );
  return undefined;
}

/**
 * canEvadeRanged = (!enforceRef8Gate || REF>=8) && Evasion skill level > 0.
 * REF path defActor.system.stats.ref.value mirrors diwako's usage.
 *
 * The Evasion skill is looked up by its CANONICAL ENGLISH NAME ("Evasion"), never the
 * localized label: core skill items are named with the fixed English name and getSkillLevel
 * filters by s.name === skillName. Passing a localized string (e.g. German "Ausweichen")
 * would match no item and always return level 0.
 */
function computeCanEvadeRanged(defActor) {
  const enforce = Settings.get("enforceRef8Gate");
  const refOk = !enforce || (defActor.system?.stats?.ref?.value ?? 0) >= 8;
  let level = 0;
  if (typeof defActor.getSkillLevel === "function") {
    level = defActor.getSkillLevel(EVASION_SKILL_NAME);
  }
  if (!level) {
    // Direct item fallback (covers a hypothetical getSkillLevel absence).
    level =
      defActor.itemTypes.skill.find((s) => s.name === EVASION_SKILL_NAME)?.system
        ?.level ?? 0;
  }
  return refOk && level > 0;
}

/**
 * Whether the fired weapon qualifies for the auto-damage step. Excludes only AoE / explosive and
 * thrown weapons (grenade/rocket launchers, thrown) per the user's "keine Granaten" rule. Basic
 * single-shot ranged, aimed shots, autofire, and any melee weapon are eligible - damage.js rolls
 * the matching damage kind (autofire falls back to manual only when its multiplier is unknown).
 * @param {Item} weapon
 * @returns {boolean}
 */
function computeDamageEligible(weapon) {
  const excluded = ["grenadeLauncher", "rocketLauncher", "thrownWeapon"];
  return !excluded.includes(weapon.system?.weaponType);
}

/**
 * preCreateChatMessage hook (registered in main.js ready, runs on EVERY client): when the
 * suppressDiwakoHit setting is on AND diwako-cpred-additions is active, cancel diwako's plain
 * hit/miss chat line so it cannot spoil the result before the target chooses Evade/Tank
 * (REQUIREMENT 1b - blind decision).
 *
 * diwako posts its line as (diwako main.js:218):
 *   content: `<div class="cpr-block" style="padding:10px;background-color:${backgroundColor}">...`
 * with backgroundColor = 'var(--cpr-text-chat-failure, ...)' | 'var(--cpr-text-chat-success, ...)'.
 * We match on that exact literal signature so unrelated cpr-block cards are never eaten.
 *
 * NOTE: diwako's Sequencer hit/miss ANIMATIONS (if enabled) are NOT chat messages and are not
 * suppressed by this hook.
 * @returns {boolean} false cancels creation; true (undefined) allows it.
 */
export function onPreCreateChatMessage(message, data) {
  const content =
    (typeof message?.content === "string" && message.content) || data?.content || "";

  // (A) SUPPRESS diwako's plain hit/miss line so it cannot spoil the result before the choice.
  if (
    Settings.get("suppressDiwakoHit") &&
    game.modules.get("diwako-cpred-additions")?.active &&
    typeof content === "string" &&
    content.includes('class="cpr-block"') &&
    content.includes("padding:10px;background-color:var(--cpr-text-chat-")
  ) {
    console.log(`${LOG} | suppressing diwako hit/miss chat line (blind decision)`);
    return false;
  }

  // (B) BLIND the attacker's OWN ranged attack-roll card from the defending PLAYER, so they must
  // choose Evade/Tank BEFORE seeing how high the roll is (anti-metagame). We do not cancel the
  // card - we just re-whisper it to GMs + the attacker so the defender player never sees the
  // number. After they decide, the result card states attack vs evasion/DV anyway. Only applies
  // when the target is controlled by a non-GM player (NPC defense is adjudicated by the GM, who
  // may see the roll). preCreate runs only on the creating (attacker) client, so game.user is the
  // attacker and updateSource here propagates the whisper to every client.
  if (Settings.get("blindAttackRoll")) {
    try {
      const whisper = computeBlindWhisper(message, content);
      if (whisper) {
        message.updateSource({ whisper, blind: false });
        console.log(`${LOG} | blinded ranged attack roll from the defender player`);
      }
    } catch (e) {
      console.warn(`${LOG} | blindAttackRoll failed - leaving the attack card as-is`, e);
    }
  }

  return true;
}

/**
 * If this pending chat message is a RANGED attack card fired at a non-GM-player-controlled target
 * (and the ranged prompt is enabled), return the whisper recipient list that hides the roll from
 * that player (all GMs + the attacker). Otherwise return null (leave the card untouched).
 * Mirrors the attack-card parsing used by onCreateChatMessage; best-effort (any failure -> null).
 * @param {ChatMessage} message the pending document (preCreate)
 * @param {string} content its HTML content
 * @returns {string[]|null}
 */
function computeBlindWhisper(message, content) {
  if (!content) return null;
  if (!Settings.get("enableRangedPrompt")) return null;

  const DIV = document.createElement("DIV");
  DIV.innerHTML = content;

  const isAttack = DIV.querySelector(
    `[data-tooltip='${game.i18n.localize("CPR.actorSheets.commonActions.rollDamage")}']`
  );
  const attackData = DIV.querySelector("[data-action=rollDamage]")?.dataset;
  if (!isAttack || !attackData) return null;

  const subtitle = DIV.querySelector("div.rollcard-subtitle-center.text-small")?.innerHTML?.trim();
  if (subtitle === game.i18n.localize("CPR.rolls.suppressiveFire")) return null;

  const targets = Array.from(game.user?.targets ?? message.author?.targets ?? []);
  if (targets.length === 0) return null;

  // Only RANGED attacks are prompted (thrown -> melee, no choice), so only those need blinding.
  const atkToken =
    message.speaker?.token ||
    canvas.scene?.tokens.get(attackData.tokenId) ||
    canvas.scene?.tokens.getName(message.speaker?.alias);
  const atkActor = atkToken?.actor ?? game.actors.get(attackData.actorId);
  const weapon = atkActor?.items.get(attackData.itemId);
  if (!weapon) return null;
  if (!(weapon.system.isRanged && weapon.system.weaponType !== "thrownWeapon")) return null;

  // Blind the roll if ANY targeted token is controlled by a non-GM PLAYER (a GM-only target needs
  // no blinding - the GM adjudicates and may see the roll).
  const anyPlayerDefender = targets.some((t) => {
    const dActor = t?.document?.actor;
    if (!dActor) return false;
    const rid = Sockets.resolveResponsibleUser(dActor);
    const r = rid ? game.users.get(rid) : null;
    return !!r && !r.isGM;
  });
  if (!anyPlayerDefender) return null;

  // Whisper to every GM plus the attacker (this client). Every player - including the defender and
  // any bystander who could coach them - is excluded, so nobody metagames the roll size.
  const ids = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
  ids.add(game.userId);
  return Array.from(ids);
}
