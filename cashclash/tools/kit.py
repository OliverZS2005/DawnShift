# Blender script: turns a Poly Haven modular facade kit (CC0) into the building pieces the web and desktop
# versions put together into city blocks. fetch-assets.mjs runs it:
#   blender -b --python tools/kit.py -- <kit .gltf> <out.glb> <pieces.json> [keep]
# pieces.json maps each piece we want to the kit objects merged into it, e.g. "large": ["wall_window_
# centered_large_01", "window_centered_large_01", "cornice_standard_standard_01"]: one 3 m bay of wall with
# its window and the moulding along the floor line. The kit models every bay with its origin at the bay's
# bottom right corner, so merged parts line up. Out comes one object per piece at the origin, in metres,
# glTF axes: the bay runs from x = -3 to 0, up is +Y and the front faces +Z. Flat walls are thinned out
# (the kit's walls are finely divided for sculpting) and dense parts lightly decimated: a block has
# hundreds of bays. `keep` leaves the triangles alone (small kits, like the fence).
import json
import sys
import bpy
import bmesh

args = sys.argv[sys.argv.index("--") + 1:]
src, out, spec = args[0], args[1], json.load(open(args[2]))
keep = len(args) > 3 and args[3] == "keep"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}

def find(name):
    if name in objs:
        return objs[name]
    for n, o in objs.items(): # Blender renames duplicates "name.001"
        if n.split(".")[0] == name:
            return o
    raise KeyError(name)

made = []
for piece, parts in spec.items():
    me = bpy.data.meshes.new(piece)
    bm = bmesh.new()
    mats = []
    for p in parts:
        o = find(p)
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        local = o.matrix_basis.copy() # the part relative to its own origin (rotation and scale kept)
        local.translation = (0, 0, 0)
        tmp.transform(local)
        remap = [] # material slots into the merged mesh's list
        for m in o.data.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for f in tmp.faces:
            f.material_index = remap[f.material_index] if remap else 0
        data = bpy.data.meshes.new("tmp")
        tmp.to_mesh(data)
        tmp.free()
        bm.from_mesh(data)
        bpy.data.meshes.remove(data)
    for m in mats:
        me.materials.append(m)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(piece, me)
    bpy.context.scene.collection.objects.link(ob)
    made.append(ob)

for o in list(objs.values()):
    bpy.data.objects.remove(o, do_unlink=True)

# thin out: merge coplanar faces (flat plaster and brick walls), then decimate what is still dense
for ob in made:
    bpy.context.view_layer.objects.active = ob
    before = len(ob.data.polygons)
    m = ob.modifiers.new("planar", "DECIMATE")
    m.decimate_type = "DISSOLVE"
    m.angle_limit = 0.0175 # 1 degree
    m.delimit = {"MATERIAL", "UV", "SEAM"}
    bpy.ops.object.modifier_apply(modifier=m.name)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > 1200 and not keep:
        m = ob.modifiers.new("collapse", "DECIMATE")
        m.ratio = max(0.3, 1200 / tris)
        bpy.ops.object.modifier_apply(modifier=m.name)
    ob.data.validate()
    print("piece", ob.name, before, "->", sum(len(p.vertices) - 2 for p in ob.data.polygons), "tris")

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_image_format="AUTO", export_apply=True)
print("wrote", out)
