/**
 * cpred-evasion-workflow - receiver handlers (run on the DEFENDER's responsible client).
 *
 * onMelee  -> resolve immediately (no prompt).
 * onPrompt -> post an interactive whispered Evade/Tank card; wire button clicks;
 *             auto-resolve to Tank after promptTimeoutSeconds (0 = wait indefinitely).
 *
 * Both dedupe on requestId via a module-level Set (one-shot guard #1). The result card
 * is created by resolve.postResult on THIS client; Foundry natively broadcasts it to all
 * clients, so no socket round-trip is needed for the result.
 */
import { MODULE_ID, LOG, KIND } from "./constants.js";
import { Settings } from "./settings.js";
import { resolveEvasion, postResult } from "./resolve.js";

// One-shot guard: a given requestId is processed exactly once on this client.
const processed = new Set();

// Tracks pending prompt timeouts so a click can cancel the auto-Tank.
const pendingTimeouts = new Map();
// Tracks which requestIds already had a button acted on (prevents double-click race).
const actedPrompts = new Set();

/** MELEE receiver: immediately roll opposed Evasion and post the result. */
export async function onMelee(payload) {
  const { requestId } = payload;
  if (processed.has(requestId)) return;
  processed.add(requestId);

  console.log(`${LOG} | onMelee`, payload);
  // untrained:true asks resolveEvasion to roll a bare DEX+d10 (Evasion level 0) opposed
  // check when the actor has NO Evasion skill item, because in CP:R melee is always opposed
  // and an untrained defender still rolls their governing stat. Many mook/imported NPCs ship
  // without the Evasion item; they must still get to defend rather than be auto-hit.
  const { evasionTotal, dodged, ok, untrainedDefense } = await resolveEvasion({
    ...payload,
    untrained: true,
  });
  if (!ok) {
    // Could not build ANY roll (e.g. missing DEX stat / roll classes) -> hit stands,
    // flagged noSkill so the card reads correctly instead of "Evasion 0".
    await postResult(KIND.MELEE_HIT, { ...payload, evasionTotal: 0, noSkill: true });
    return;
  }
  await postResult(dodged ? KIND.MELEE_DODGED : KIND.MELEE_HIT, {
    ...payload,
    evasionTotal,
    untrainedDefense: !!untrainedDefense,
  });
}

/** RANGED receiver: post the interactive Evade/Tank prompt (whispered to this user). */
export async function onPrompt(payload) {
  const { requestId, atkName, defName, canEvadeRanged } = payload;
  if (processed.has(requestId)) return;
  processed.add(requestId);

  console.log(`${LOG} | onPrompt`, payload);

  const body = game.i18n.format(`${MODULE_ID}.prompt.body`, {
    attacker: atkName,
    target: defName,
  });
  const cannotEvade = game.i18n.localize(`${MODULE_ID}.prompt.cannotEvade`);

  const evadeDisabledAttrs = canEvadeRanged
    ? ""
    : `disabled data-tooltip="${cannotEvade}"`;

  const content = `
<div class="cpr-evasion-prompt" data-request-id="${requestId}">
  <div class="cpr-evasion-title">${game.i18n.localize(`${MODULE_ID}.prompt.title`)}</div>
  <div class="cpr-evasion-body">${body}</div>
  <div class="cpr-evasion-buttons">
    <button type="button" class="cpr-evasion-btn evade" data-action="cpr-evade" data-request-id="${requestId}" ${evadeDisabledAttrs}>
      ${game.i18n.localize(`${MODULE_ID}.prompt.evade`)}
    </button>
    <button type="button" class="cpr-evasion-btn tank" data-action="cpr-tank" data-request-id="${requestId}">
      ${game.i18n.localize(`${MODULE_ID}.prompt.tank`)}
    </button>
  </div>
</div>`;

  // Whisper the prompt to this user only (the responsible defender user).
  await ChatMessage.create({
    content,
    whisper: [game.userId],
    speaker: { alias: game.i18n.localize(`${MODULE_ID}.prompt.title`) },
    flags: {
      [MODULE_ID]: {
        prompt: true,
        requestId,
        payload,
        defenderUserId: game.userId,
      },
    },
  });

  // Timeout -> default to Tank.
  // KNOWN LIMITATION: this auto-Tank timer is in-memory on the defender client. If that
  // client reloads/crashes before clicking, the timer is lost; a returning defender can
  // still click the persisted card, but the auto-Tank guarantee lapses. Documented as-is.
  const timeoutSecs = Number(Settings.get("promptTimeoutSeconds")) || 0;
  if (timeoutSecs > 0) {
    const handle = setTimeout(async () => {
      pendingTimeouts.delete(requestId);
      if (actedPrompts.has(requestId)) return;
      actedPrompts.add(requestId);
      console.log(`${LOG} | prompt ${requestId} timed out -> Tank`);
      await resolveTank(payload);
    }, timeoutSecs * 1000);
    pendingTimeouts.set(requestId, handle);
  }
}

/**
 * Bind prompt button clicks. Registered once (see registerPromptHooks below).
 * Only the defender user who received the whisper can act.
 */
async function onEvadeClick(payload) {
  const { requestId } = payload;
  if (actedPrompts.has(requestId)) return;
  actedPrompts.add(requestId);
  clearPromptTimeout(requestId);

  console.log(`${LOG} | evade clicked for ${requestId}`);
  // Ranged Evade is a deliberate action gated behind canEvadeRanged (needs the skill),
  // so we do NOT pass untrained here: a bullet-dodge without the skill is not offered.
  const { evasionTotal, dodged, ok } = await resolveEvasion(payload);
  if (!ok) {
    await postResult(KIND.FAILED, { ...payload, evasionTotal: 0, noSkill: true });
    return;
  }
  await postResult(dodged ? KIND.DODGED : KIND.FAILED, { ...payload, evasionTotal });
}

async function onTankClick(payload) {
  const { requestId } = payload;
  if (actedPrompts.has(requestId)) return;
  actedPrompts.add(requestId);
  clearPromptTimeout(requestId);

  console.log(`${LOG} | tank clicked for ${requestId}`);
  await resolveTank(payload);
}

/**
 * Resolve a Tank choice (also used by the timeout auto-Tank). NO Evasion roll: the shot's
 * hit/miss was decided by the DV computed on the attacker client and shipped in the payload
 * (blind decision). hit -> TANKED (a hit, so the damage step runs); miss -> MISSED_ANYWAY
 * (the tanked shot simply missed - no damage). dv=null (undeterminable) counts as a hit.
 */
async function resolveTank(payload) {
  const { dv, attackTotal } = payload;
  const hit = dv == null ? true : attackTotal > dv;
  await postResult(hit ? KIND.TANKED : KIND.MISSED_ANYWAY, payload);
}

function clearPromptTimeout(requestId) {
  const handle = pendingTimeouts.get(requestId);
  if (handle) {
    clearTimeout(handle);
    pendingTimeouts.delete(requestId);
  }
}

/**
 * renderChatMessage hook: wire the prompt buttons on the defender's client.
 * Registered from main.js ready via registerPromptHooks().
 */
function bindPromptButtons(msg, html) {
  const flag = msg.flags?.[MODULE_ID];
  if (!flag?.prompt) return;
  if (game.userId !== flag.defenderUserId) return;

  const root = html instanceof jQuery ? html : $(html);
  const payload = flag.payload;

  root.find("button[data-action=cpr-evade]").on("click", (ev) => {
    ev.preventDefault();
    disableButtons(root);
    onEvadeClick(payload);
  });
  root.find("button[data-action=cpr-tank]").on("click", (ev) => {
    ev.preventDefault();
    disableButtons(root);
    onTankClick(payload);
  });
}

function disableButtons(root) {
  root.find("button.cpr-evasion-btn").prop("disabled", true);
}

// Register the renderChatMessage binding exactly once.
let promptHooksRegistered = false;
Hooks.once("ready", () => {
  if (promptHooksRegistered) return;
  promptHooksRegistered = true;
  Hooks.on("renderChatMessage", bindPromptButtons);
});
