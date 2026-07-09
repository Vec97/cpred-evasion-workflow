/**
 * cpred-evasion-workflow - main entry (ESM).
 *
 * Standalone Foundry V12 companion module for cyberpunk-red-core (v0.89+).
 * Coexists with diwako-cpred-additions without modifying or importing it.
 *
 * Wiring:
 *   init            -> register world settings
 *   socketlib.ready -> register the module socket + receiver functions
 *   ready           -> register createChatMessage (attacker-side detection) + preCreateChatMessage
 *                      (diwako hit/miss suppression for the blind decision, runs on all clients)
 *
 * Exposes game.modules.get('cpred-evasion-workflow').api = { resolveEvasion } for debugging.
 */
import { MODULE_ID, LOG } from "./constants.js";
import { Settings } from "./settings.js";
import { Sockets } from "./sockets.js";
import { onCreateChatMessage, onPreCreateChatMessage } from "./detect.js";
import { resolveEvasion } from "./resolve.js";

Hooks.once("init", () => {
  console.log(`${LOG} | init - registering settings`);
  Settings.register();
});

// Register the socket in socketlib.ready (guaranteed bound before ready).
Hooks.once("socketlib.ready", () => {
  console.log(`${LOG} | socketlib.ready - registering module socket`);
  Sockets.register();
});

Hooks.once("ready", () => {
  if (!game.modules.get("socketlib")?.active) {
    console.error(`${LOG} | socketlib is not active - this module requires socketlib. Aborting hook registration.`);
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.error.noSocketlib`));
    return;
  }
  console.log(`${LOG} | ready - registering chat hooks (createChatMessage + preCreateChatMessage)`);
  Hooks.on("createChatMessage", onCreateChatMessage);
  // Runs on every client: cancels diwako's spoiler hit/miss line for the blind decision.
  Hooks.on("preCreateChatMessage", onPreCreateChatMessage);

  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { resolveEvasion };
});
