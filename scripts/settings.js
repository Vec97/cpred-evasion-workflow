/**
 * cpred-evasion-workflow - world settings.
 *
 * All rules-affecting settings are scope 'world' so the GM controls table behavior.
 */
import { MODULE_ID } from "./constants.js";

export class Settings {
  static register() {
    game.settings.register(MODULE_ID, "enableRangedPrompt", {
      name: game.i18n.localize(`${MODULE_ID}.settings.enableRangedPrompt.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.enableRangedPrompt.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "enableAutoMelee", {
      name: game.i18n.localize(`${MODULE_ID}.settings.enableAutoMelee.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.enableAutoMelee.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "enforceRef8Gate", {
      name: game.i18n.localize(`${MODULE_ID}.settings.enforceRef8Gate.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.enforceRef8Gate.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });

    game.settings.register(MODULE_ID, "promptTimeoutSeconds", {
      name: game.i18n.localize(`${MODULE_ID}.settings.promptTimeoutSeconds.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.promptTimeoutSeconds.hint`),
      scope: "world",
      config: true,
      type: Number,
      default: 0,
    });

    game.settings.register(MODULE_ID, "whisperResult", {
      name: game.i18n.localize(`${MODULE_ID}.settings.whisperResult.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.whisperResult.hint`),
      scope: "world",
      config: true,
      type: String,
      choices: {
        public: game.i18n.localize(`${MODULE_ID}.settings.whisperResult.public`),
        gm: game.i18n.localize(`${MODULE_ID}.settings.whisperResult.gm`),
        both: game.i18n.localize(`${MODULE_ID}.settings.whisperResult.both`),
      },
      default: "public",
    });

    game.settings.register(MODULE_ID, "tieGoesToDefender", {
      name: game.i18n.localize(`${MODULE_ID}.settings.tieGoesToDefender.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.tieGoesToDefender.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "autoDamage", {
      name: game.i18n.localize(`${MODULE_ID}.settings.autoDamage.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.autoDamage.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "suppressDiwakoHit", {
      name: game.i18n.localize(`${MODULE_ID}.settings.suppressDiwakoHit.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.suppressDiwakoHit.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "blindAttackRoll", {
      name: game.i18n.localize(`${MODULE_ID}.settings.blindAttackRoll.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.blindAttackRoll.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, "logMissingTarget", {
      name: game.i18n.localize(`${MODULE_ID}.settings.logMissingTarget.name`),
      hint: game.i18n.localize(`${MODULE_ID}.settings.logMissingTarget.hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });
  }

  static get(key) {
    return game.settings.get(MODULE_ID, key);
  }
}
