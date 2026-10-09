# FableCraft

A from-scratch Minecraft-style voxel sandbox that runs entirely in the browser.
No external assets and no libraries: every texture, model skin, sound effect, the music
and even the pixel font are generated in code at startup.

## Play

```bash
node server.js        # then open http://localhost:8080
```

Any static file server works too (e.g. `python3 -m http.server`). The game uses ES modules
and web workers, so it must be served over http(s) rather than opened from `file://`.

For a version that is one self-contained HTML file (it opens straight from disk):

```bash
node tools/build-single.mjs   # writes dist/fablecraft.html
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Space` | Jump / swim up (double-tap to fly in Creative) |
| `Left Shift` | Sneak / fly down |
| Double-tap `W`, `R` or `Ctrl` | Sprint |
| Left / right mouse | Mine & attack / place & use |
| Middle mouse | Pick block |
| `1`-`9`, scroll | Hotbar |
| `E` | Inventory (2x2 crafting, armor) |
| Arrow keys | Turn the camera (also works when the mouse cannot be captured) |
| `Q` | Drop item |
| `T` or `/` | Chat & commands (`/help`) |
| `F1` / `F3` / `F5` | Hide HUD / debug overlay / third-person camera |
| `F` | Fullscreen |
| `Esc` | Pause menu |

Inventory screens work like Minecraft's: drag a held stack across slots to split it evenly
(right-drag places one per slot), double-click to gather matching items, shift-click to move
stacks (hold shift and drag to move several), `1`-`9` to swap with the hotbar, `Q` to throw the
hovered item out, and click outside the window to drop what you are holding.

## What's in it

- Infinite terrain: oceans, rivers, beaches, plains, forests, birch forests, taiga, snowy
  biomes, deserts, savanna, swamps and mountains, with caves, lava, ores and biome-tinted
  grass, foliage and water.
- Survival and Creative modes: health, hunger, air, fall damage, XP, armor, tools with
  durability and Minecraft's mining speeds; saving and loading of multiple worlds (IndexedDB).
- Tick-accurate movement physics (20 TPS with interpolation): walking, sprinting, sneaking
  with edge protection, jumping, swimming, ladders, step-up, flying, view bobbing.
- Sky and block lighting with smooth lighting and ambient occlusion, day/night cycle, sun,
  moon, stars, sunsets, clouds, fog and underwater effects.
- Flowing water and lava (with obsidian/cobblestone generation), falling sand and gravel,
  TNT and explosions, fire, leaf decay, growing saplings, crops, sugar cane and cactus.
- 110+ blocks including slabs, stairs, fences, doors, ladders, torches, beds, chests,
  furnaces and crafting tables; 100+ items; shaped and shapeless crafting, smelting.
- Mobs with AI and procedurally generated sounds: pigs, cows, sheep (shearable), chickens,
  zombies, skeletons (with arrows), creepers and spiders. Bows, buckets, bone meal, farming.
- Minecraft-style GUI: title screen with live panorama, world list, options, inventory,
  crafting, furnace, chest and creative screens, chat with commands, debug overlay.

## Layout

```
index.html, style.css   page shell and GUI styling
server.js               tiny static server
src/main.js             game loop, input, camera, commands
src/world.js            chunks, lighting updates, fluids, block ticks, explosions, ray casts
src/worldgen.js         terrain, biomes, caves, ores, trees (runs in workers)
src/mesher.js           chunk meshing with smooth lighting (runs in workers)
src/renderer.js         WebGL2 renderer
src/textures.js         procedural pixel art for all blocks and items
src/player.js           player physics, survival stats, mining, placing, item use
src/mobs.js, models.js  entities, mob AI, box models and skins
src/ui.js, font.js      GUI and the generated pixel font
src/audio.js            synthesised sound effects and music
src/save.js             world persistence
```
