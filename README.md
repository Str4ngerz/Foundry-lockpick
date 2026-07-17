# Skyrim Lockpicking

## Installation
Unzip the `skyrim-lockpicking` folder to `Data/modules/` in your Foundry, or
install from the local `module.json` via "Install Module" -> "Manifest URL".
Enable the module in the world settings.

## How it works

### 1. Difficulty (GM only)
`Game Settings -> Configure Module Settings -> Sklockpicking: Default Lock Difficulty`
Players see this field, but only the GM can change it (default behavior
in Foundry world-scope settings).

### 2. The "Hackable" flag on an item or actor
On the **Item** sheet and the **Actor** sheet (for chest/door actors), the GM
will see a button in the window header: **🔒 Lock**. Here you can set:
- **Hackable** — activates the minigame on click
- **Locked** — unlocks automatically after successfully hacking with a module
- **Difficulty** — either "as in general settings" or a specific value
just for this item/actor (individual override)
- **This is a consumable lockpick** (for items only) — mark an item
of the "Lockpick" type in the character's inventory as such; this is the item that will be consumed when hacked

### 3. Entry Points for Players
- **Inventory**: Clicking on the row of a hackable item on the character sheet
opens the minigame instead of opening the item card normally. Lockpicks from the inventory of the same character are consumed.
- **Token Chest**: Double-clicking on a token whose actor is marked as
"hackable" opens the minigame instead of the actor's sheet. Lockpicks
of the assigned player character (`game.user.character`) are consumed. The click listener
is attached directly to the token's PIXI object (`token.on("pointerdown", ...)`), not to `Token.prototype._onClickLeft2` — specifically to ensure it works for
players without Owner rights to the token chest (a regular click wouldn't reach the code for them, so previously only GMs would trigger it).

### 4. Mandatory "Lockpick" Item
Without an item named **"Lockpick"** (case-insensitive) or explicitly
marked with the "this is a lockpick consumable" flag in the inventory of the lockpicking character, the minigame won't open at all — only a warning will appear in the
corner of the screen. This applies to both methods of invoking (inventory and token chest).

## Sound
Synthesized sound via Web Audio has been replaced with regular mp3 placeholders.
Place the files `scratch.mp3`, `break.mp3`, and `success.mp3` in the `sounds/` folder (see `sounds/README.txt`) - the code will pick them up automatically.

## Sleight of Hand Bonus
Lockpick durability and safe zone size are scaled by the modifier of the player-controlled character's **Sleight of Hand** skill (`system.skills.slt`, dnd5e): `+0.05` (i.e. +5%) for each modifier point, with a cap of
`+1.0`/`-0.5`. If the actor doesn't have this skill (for example, a GM without an assigned character), the bonus will be `+0.0` (default, unchanged).
The current value is shown in the corner of the lockpicking window, for example:
`Sleight of Hand: +6 (lockpick durability +0.3, area size +0.3)` - this immediately
shows that the bonus has actually been applied.

## Known assumptions (can be adjusted for your system)
- Consuming lockpicks reduces the `system.quantity` of the lockpick item by 1 when broken.
If the field is called differently in the D&D5e system, adjust it in `_consumeLockpick()`
in `scripts/lockpick-app.js`.
- Successful lockpicking sets `locked = false` on the document and closes the window
(without chat messages - removed by request); does not automatically
open doors or loot - this is an integration point for a specific setup (Item Piles, Walls doors, etc.).
