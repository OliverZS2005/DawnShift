# Skin → 3D Print

A browser-only tool that turns a Minecraft skin texture into a 3D-printable
model. Upload a skin PNG, preview the figure in 3D, and export print-ready
files. Nothing is uploaded anywhere — everything runs client-side.

Open `index.html` (via a local static server, since it uses ES modules —
see below) and drop in a skin.

## How it works

A Minecraft skin is a 64×64 (or legacy 64×32) texture that wraps six boxes
(head, body, two arms, two legs) using Mojang's standard "box UV" unwrap,
each with a base layer plus a semi-transparent overlay layer (hat, jacket,
sleeves, pants).

- **Base layer** — rendered as solid, textured boxes. The original PNG is
  used directly as the texture, so full pixel detail carries straight
  through with no re-baking.
- **Overlay layer** — a flat textured box can't represent "this pixel is
  see-through, this one isn't," which is what overlay content actually
  needs. Instead, every opaque overlay texel is voxelized into its own
  small printable cuboid, extruded outward from the body's surface. That's
  what gives hats, hair, and sleeves real printable geometry instead of
  disappearing or printing as a solid shell.
- Adjoining parts (head/body, arms/body, legs/body) are nudged to overlap
  slightly rather than just touch, so the exported mesh fuses into a
  single printable unit instead of separate coincident faces.
- Legacy 64×32 skins only ever had a hat layer (jacket/sleeves/pants were
  added later, in the 64×64 format) and have no separate left-arm/left-leg
  texture region — the left side is mirrored from the right automatically.

See `js/skinLayout.js` for the UV math and `js/meshBuilder.js` for how the
mesh is assembled.

## Export formats

- **STL** (binary) — geometry only, for single/multi-color FDM printing or
  any generic slicer.
- **OBJ + MTL + PNG** (zipped) — full-color, UV-textured mesh referencing
  your original skin PNG unmodified. Use this for full-color print
  services, or open `model.obj` in Blender etc.

Total print height is configurable in millimeters; width/depth/height and
triangle count are shown live.

## Running locally

Because the app uses ES module imports (`<script type="module">`) and an
import map, opening `index.html` directly via `file://` won't work in most
browsers — serve the folder instead:

```sh
cd minecraft-skin-3d-converter
python3 -m http.server 8080
# open http://localhost:8080
```

Any static file server works equally well.

## Project layout

```
index.html          app shell + import map
styles.css           
js/
  skinLayout.js      box-UV math + body part/UV table
  meshBuilder.js      builds the printable mesh from a skin texture
  exporters.js        STL / OBJ+MTL writers
  sampleSkin.js        procedurally generated placeholder skin
  main.js             UI wiring, three.js preview, export buttons
lib/                  vendored three.js (+ OrbitControls) and JSZip
```

## Limitations

- Only standard 64×64 / legacy 64×32 skins are supported (no HD/4x skins).
- Arm shape (classic vs. slim) can't be auto-detected reliably from pixel
  data, so it's a manual toggle in the UI.
- The overlay layer is voxelized at 1 texel = 1 model unit resolution, so
  overlay detail is exactly as fine as the source texture and no finer.
