# 💰 Cash Clash

A money tycoon with a first-person arena shooter. Win a battle and you take 10% of your opponent's money; lose and they take 10% of yours.

## Fights (first person)
| Key | Does |
|---|---|
| Mouse | Look around (the first click captures the mouse; **Esc** gives it back) |
| Click / hold | Fire |
| W / S or ↑ / ↓ | Forward / back |
| A / D | Strafe |
| ← / → | Turn without the mouse |
| R | Reload |
| 1–5 | Switch weapon (Pistol, SMG, Shotgun, Sniper, Rocket Launcher) |

The HUD shows your health and ammo, the opponent's name and health, what's at stake, and a minimap. The opponent only appears on the minimap while you can see them, or for a moment after they fire.

## Graphics
Both the web and desktop versions are fully 3D and aim for a GTA IV look: photoreal people (Microsoft Rocketbox) who run, back-pedal and turn to aim with both hands on the gun; real gun models (a 1911-style pistol, a Micro Uzi, a Benelli shotgun, a hunting rifle and an RPG-7); photo-scanned props and materials, real HDRI skies, shadows, ambient occlusion and bloom. Fights take place in courtyards inside city blocks, and your business sits in a plaza in the middle of the city: buildings with photographed fronts (lights on in the windows at night), storefronts and rooftop water tanks, wet streets with puddles that mirror the sky, lane markings, crossings, oil stains and manholes, real car models parked and driving round the blocks, street lamps, and a skyline that fades into the smog. A washed-out, sepia colour grade with film grain finishes it off. On the tycoon tab you walk around your business in first person (click, then WASD and the mouse; Shift runs): look at a lot and press E to buy or R to upgrade. Every business you own runs a production line where machines put boxes on a conveyor that carries them to the till, faster as it earns more.
- `models.js` describes every scene once (buildings, arena themes, decoration and prop placement). `render3d.js` (web, Three.js) and `desktop/r3d.gd`, `city3d.gd`, `arena3d.gd` (Godot) both build from it, so the two versions look the same.
- The art lives in `desktop/assets/` (credits in `desktop/assets/CREDITS.md`). It's CC0, except the people (Microsoft Rocketbox, MIT licence) and the HUD fonts (SIL Open Font License). `tools/fetch-assets.mjs` downloads and converts it; the people and guns need Blender for the conversion.
- The web page loads that art over HTTP, so play it through a server (`npm start`). If you open `index.html` straight from disk it still works, with simple shapes instead.
- The web version lowers its own quality on slow computers. Add `?quality=low`, `medium` or `high` to the address to choose yourself.

## Progression
- **Milestones:** owning 25, 50, 100 or 200 of one building doubles that building's output each time.
- **Reboot** (🔄 tab): wipes your money, buildings and weapons, and moves you up one business level. There are 7 levels, from Street Hustler to Galactic Empire. Each level doubles your income for good and unlocks a new building (Factory, Bank, Oil Rig, Space Mine, AI Lab, Dyson Sphere).
- **Prestige:** at level 7, rebooting earns Boost Points instead. You get more if you overshoot the goal. Spend them on permanent perks: Income, Firepower, Toughness, Agility, Head Start, Night Shift and Lucky Streak. Firepower, Toughness and Agility also make you stronger in battle.
- **Random events:** 📈 Market Boom (x3 income), 🏷️ Fire Sale (buildings 40% off) and 🎁 Golden Crate (claim it for 90 seconds of income).
- **Rivals level up too:** computer rivals run their own tycoons. They reboot through the business levels, prestige, and get better weapons and perks. Matchmaking weighs business level as well as money.
- **Arena maps:** Warehouse, Pillars, Corridors and Vault. Each fight picks one at random.

## Desktop app (Godot)
The desktop version lives in [`desktop/`](desktop/). It's a Godot 4.3 project with the same game, the same save format and the same multiplayer protocol, so desktop and web players fight each other on the same servers.
- **Download:** every change builds Windows, Mac and Linux versions with the *Cash Clash desktop* GitHub workflow and publishes them as the [cashclash-latest release](https://github.com/OliverZS2005/ClaudeCodeIsTuff/releases/tag/cashclash-latest). The Mac build isn't signed with a paid certificate, so right-click it and choose **Open** the first time.
- **Graphics:** the desktop app renders with Vulkan (Forward+; Macs run it through MoltenVK), which adds screen-space bounce light, reflections on smooth floors, volumetric haze and light shining through the grass. A computer with no Vulkan support at all falls back to OpenGL with simpler lighting instead of refusing to start.
- **Run from source:** open `desktop/project.godot` in Godot 4.3+ and press Play.
- `desktop/rules.gd` is a port of `shared.js`. CI fails if the two ever calculate different numbers (`tests/parity.gd` vs. `tests/parity.js`).

## Sync between web and desktop
In the 🎮 Play tab, under **Sync**, create a sync code on one device and enter it on the other. Your singleplayer game and your multiplayer logins are then stored on a Cash Clash server under that code and stay in sync. Each device pushes its save every 20 seconds and when you close it, and loads the other device's progress if that's newer. Play on one device at a time; if both play at once, the device that saves second loses its progress since the last sync.

## Singleplayer
Run `npm start` and open http://localhost:8080. Singleplayer runs entirely on your PC and you fight computer rivals.
You get exactly one singleplayer game. You can reset it from the 🎮 Play tab, but you can't create another.

## Multiplayer
In 🎮 Play, enter a server address and join. The first time you join a server, you choose:
- **New multiplayer tycoon**: start fresh, and use that tycoon only on this server.
- **Import singleplayer tycoon**: copy your singleplayer progress to the server. Your singleplayer game keeps its own copy.

The server remembers you through a token stored in your browser, so the next time you join you go straight back in.

## Host your own server
```
cd cashclash
npm install --omit=dev
npm start          # http://localhost:8080
```
(`--omit=dev` skips the tools that only rebuild the art and the 3D bundle.)
Players can open `http://<your-ip>:8080` or type that address into the Play tab.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | Port to listen on |
| `SERVER_NAME` | Cash Clash Server | Name shown to players |
| `DATA_FILE` | ./players.json | Where player profiles are saved |
| `SYNC_FILE` | next to `DATA_FILE`, `syncs.json` | Where sync codes and their saves are kept |
| `ALLOW_IMPORT` | 1 | Set to `0` to forbid importing singleplayer saves (they're edited locally, so players could cheat) |

The server controls money, purchases, matchmaking and the battle simulation, so clients can only send inputs.
To make online play feel smooth, your own player is predicted locally and corrected against the server. Your opponent and the bullets are drawn about 100ms behind the server, smoothed between updates.
Matchmaking pairs the queued players whose wealth is closest on a log scale. The range it accepts widens the longer they wait.

## Rebuilding the art and the 3D bundle
You only need these to change the art or upgrade Three.js:
```
npm install
npm run fetch-assets          # downloads the art into desktop/assets (the people and guns need Blender on the PATH)
npm run build:three           # rebuilds vendor/three.bundle.js
node tools/build-models.js    # refreshes desktop/models.json after editing models.js (CI checks this)
```
