# Cyberpunk RED – Evasion Workflow

A standalone [Foundry VTT](https://foundryvtt.com/) **v12** companion module for the
**cyberpunk-red-core** system (verified on v0.92.4). It turns the "does it hit?" moment into an
interactive, automated flow: the target is asked to **Evade** or **Tank** an incoming attack, the
Evasion roll is made for them, and — optionally — the weapon damage is rolled and applied to the
token automatically.

It **coexists with** [`diwako-cpred-additions`](https://github.com/diwako/foundry-cyberpunk-red-core-additions)
without modifying it, and works standalone (Diwako is only *recommended*).

## Features

### Blind Evade / Tank decision (ranged)
When a ranged attack targets a token, the target's controlling user is asked — **before** the
hit/miss is revealed — whether they want to **Evade (Ausweichen)** or **Tank (Tanken)** the hit,
so they cannot metagame the roll:

- The attack roll card is whispered to the GM and attacker only, so the defending **player** never
  sees how high the roll is before choosing (`Hide the attack roll from the defending player`).
  NPC targets are never blinded — the GM decides for them and may see the roll.
- Diwako's plain hit/miss chat line is suppressed so it cannot spoil the result either
  (`Hide Diwako's hit/miss line`).
- **Evade** → the target's Evasion skill is rolled through the system's own roll pipeline (DEX/REF +
  skill level + wound/armor/role/active-effect mods) and compared to the attack total. Dodged if the
  Evasion total meets/beats the attack (configurable tie rule).
- **Tank** → the shot is resolved against its DV (computed on the attacker's client and shipped
  along), so a tanked shot that actually missed reports "missed anyway" with no damage.

### Automatic melee defense
Melee and thrown-in-melee attacks are resolved automatically with **no prompt** (in CP:R melee is
always an opposed roll). If the target has no Evasion skill item (common on trimmed mook/imported
NPCs), an untrained bare-stat defense is rolled instead of an automatic hit.

### Auto‑roll and apply damage (optional)
On a confirmed hit, the module can automatically roll the weapon's damage **and apply it** to the
target via the system's own damage pipeline (armor SP, ablation, head/brain location, HP), so there
is no separate *Roll Damage* → *Apply* clicking (`Auto-roll and apply damage on a hit`).

- Runs on a **GM client** (via socketlib), which has the rights to read the attacker and mutate the
  target. Damage math is **never** reimplemented — it uses `Actor#_applyDamage`.
- **Aimed shots are supported**: damage is rolled as an aimed (located) damage roll, using the
  location the attacker aimed at (defaulting to the head, with the headshot damage rules applied).
- **Excluded** (fall back to the manual *Roll Damage* button): grenade/rocket launchers, thrown
  weapons, and autofire shots. Regular single-shot ranged weapons, aimed shots, and melee weapons
  are eligible. If no GM is connected, it also falls back to manual.

## Requirements

- Foundry VTT **v12**
- System **cyberpunk-red-core** (v0.89+, verified v0.92.4)
- **[socketlib](https://foundryvtt.com/packages/socketlib)** — required (cross-client routing)
- **[diwako-cpred-additions](https://foundryvtt.com/packages/diwako-cpred-additions)** — optional /
  recommended (DV display, cover tokens, etc.)

## Install

1. Install and enable **socketlib**.
2. Copy this folder to `Data/modules/cpred-evasion-workflow` (so `module.json` sits at
   `Data/modules/cpred-evasion-workflow/module.json`), or install via the manifest URL.
3. Enable **Cyberpunk RED – Evasion Workflow** (and socketlib) in *Manage Modules*.
4. **Restart Foundry / reload the world** after first enabling it, so socketlib picks up the
   module's `"socket": true` flag.
5. Configure under *Game Settings → Configure Settings → Cyberpunk RED – Evasion Workflow*.

## Settings (all world-scoped)

| Setting | Default | Effect |
|---|---|---|
| Prompt on ranged attack | on | Ranged attack → prompt the target to Evade/Tank (before hit/miss). |
| Auto-resolve melee defense | on | Melee/thrown-in-melee → auto opposed Evasion, no prompt. |
| Require REF 8+ to dodge bullets | off | Ranged Evade only offered at REF 8+ (Dodging Bullets). |
| Prompt timeout (seconds) | 0 | Auto-default to Tank after N seconds; 0 = wait forever. |
| Result visibility | public | public / GM only / GM + involved players. |
| Ties favor the defender | on | Evasion ≥ Attack = dodged (else must strictly beat). |
| Auto-roll and apply damage on a hit | on | Roll + apply weapon damage automatically (see exclusions). |
| Hide Diwako's hit/miss line | on | Suppress Diwako's spoiler hit/miss chat line. |
| Hide the attack roll from the defending player | on | Whisper the attack roll away from the defender player (anti-metagame). |
| Log attacks with no target | off | Console note when an attack has no target. |

## How it works (technical)

- Detection runs on the **attacker's client** via `Hooks.on("createChatMessage")`, guarded by
  `game.userId != message._source.author`. It scrapes the attack total from the card DOM, resolves
  the weapon/target like Diwako, and branches on the weapon item
  (`isRanged && weaponType !== "thrownWeapon"` → ranged prompt; else melee).
- Cross-client routing uses **socketlib**: the prompt/melee resolution is sent to the target's
  single responsible user (`executeAsUser`), and the optional damage step is sent to a GM
  (`executeAsGM`). Result cards are created on the resolving client and broadcast natively.
- Blinding is done in `preCreateChatMessage` by re-whispering the attack card; the deep system
  imports (roll types, `CPRChat.RenderRollCard`, `CPRSkillRoll`) live in a single `cprSystem.js`
  shim with guarded fallbacks.
- The Evasion skill is found by its canonical English name `"Evasion"` (core skill items keep their
  English name even on a localized client), never the localized label.

## Limitations

- Diwako's Sequencer hit/miss **animations** (if you run them) are not suppressed — only the text
  line and the attack-roll card are hidden.
- The GM may see a harmless "no target selected" notice when a damage roll is auto-made.
- The blind-decision auto-Tank timeout is an in-memory timer on the defender's client; if that
  client reloads before choosing, the timeout will not fire (the persisted prompt can still be
  clicked).
- If a player can still hover the target with Diwako's DV display active, they can read the DV; turn
  that off if you want a fully blind table.

## License

MIT.
