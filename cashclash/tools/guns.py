# Blender script: turns a downloaded gun model (OpenGameArt, CC0) into a glTF binary the web and desktop
# versions load as the held weapon. fetch-assets.mjs runs it:
#   blender -b --python tools/guns.py -- <model .blend/.fbx/.gltf> <out.glb> <muzzle +x|-x> [drop regex] [finish] [level]
# Every gun comes out the same way round: barrel along glTF -Z (forward), sights up (+Y), centred on the
# origin. `drop` removes stray parts (spare magazines, silencers); `finish` paints models that ship
# without textures in gunmetal; `level` straightens a model that was saved tilted (its long axis, found
# from the vertex spread; only for long guns, as a pistol's grip would skew it).
import math
import re
import sys
import bpy
import mathutils

args = sys.argv[sys.argv.index("--") + 1:]
src, out, muzzle = args[0], args[1], args[2]
drop = re.compile(args[3]) if len(args) > 3 and args[3] else None
finish = len(args) > 4 and args[4] == "finish"
level = len(args) > 5 and args[5] == "level"

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith(".blend"):
    with bpy.data.libraries.load(src) as (lib, into):
        into.objects = lib.objects
    for o in into.objects:
        if o is not None and o.type == "MESH":
            bpy.context.scene.collection.objects.link(o)
elif src.endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in list(meshes):
    if drop and drop.search(o.name):
        bpy.data.objects.remove(o, do_unlink=True)
        meshes.remove(o)
for o in list(bpy.context.scene.objects):  # empties, cameras, lights, armatures
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# one object with its transforms applied
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
gun = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def points():
    return [v.co.copy() for v in gun.data.vertices]

# level the barrel: the main axis of the side view (X/Z), found from the vertex spread
pts = points()
cx = sum(p.x for p in pts) / len(pts)
cz = sum(p.z for p in pts) / len(pts)
sxx = sum((p.x - cx) ** 2 for p in pts)
szz = sum((p.z - cz) ** 2 for p in pts)
sxz = sum((p.x - cx) * (p.z - cz) for p in pts)
tilt = 0.5 * math.atan2(2 * sxz, sxx - szz) if level else 0.0  # angle of the main axis above +X
turn = mathutils.Matrix.Rotation(tilt, 4, "Y")  # rotating about +Y lowers +X towards -Z
if muzzle == "-x":  # muzzle to +X
    turn = mathutils.Matrix.Rotation(math.pi, 4, "Z") @ turn
turn = mathutils.Matrix.Rotation(math.pi / 2, 4, "Z") @ turn  # +X -> +Y (glTF -Z once exported)
gun.data.transform(turn)

# centre on the origin
pts = points()
lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
gun.data.transform(mathutils.Matrix.Translation(-(lo + hi) / 2))
print("size", [round(v, 3) for v in (hi - lo)], "tilt", round(math.degrees(tilt), 1))

if finish:  # no textures shipped: gunmetal receiver and barrel, black polymer for the rest
    metal = bpy.data.materials.new("gunmetal")
    metal.use_nodes = True
    b = metal.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.045, 0.047, 0.052, 1)
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = 0.36
    gun.data.materials.clear()
    gun.data.materials.append(metal)
else:  # the scans' materials, matte where the importer left them glossy
    for m in gun.data.materials:
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m and m.use_nodes else None
        if bsdf and not bsdf.inputs["Roughness"].links:
            bsdf.inputs["Roughness"].default_value = max(bsdf.inputs["Roughness"].default_value, 0.35)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_image_format="AUTO", use_selection=False)
print("wrote", out)
