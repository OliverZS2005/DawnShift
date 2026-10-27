# Blender script: turns one Microsoft Rocketbox avatar (FBX, MIT licence) plus Rocketbox animation
# FBXs into a single glTF binary the web and desktop versions can both load. fetch-assets.mjs runs it:
#   blender -b --python tools/people.py -- <avatar.fbx> <out.glb> <clip>=<animation.fbx> ...
# The animations share the avatar's "Bip01" skeleton, so each one's action is moved onto the avatar
# and exported as a named clip. Horizontal root motion is already stripped (Rocketbox "motextr_xy").
import os
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
avatar, out = args[0], args[1]
clips = dict(a.split("=", 1) for a in args[2:])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.fbx(filepath=avatar)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# The FBX points at textures on the artist's machine; they ship in the avatar's Textures folder.
textures = os.path.join(os.path.dirname(avatar), "..", "Textures")
for img in bpy.data.images:
    path = os.path.join(textures, os.path.basename(img.filepath.replace("\\", "/")))
    if os.path.exists(path):
        img.filepath = path
        img.reload()

for name, path in clips.items():
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.fbx(filepath=path)
    new = [bpy.data.objects[n] for n in set(bpy.data.objects.keys()) - before]
    src = next(o for o in new if o.type == "ARMATURE")
    act = src.animation_data.action
    for fc in list(act.fcurves):  # keep bone curves only (not the helper object's own movement)
        if not fc.data_path.startswith("pose.bones"):
            act.fcurves.remove(fc)
    act.name = name
    act.use_fake_user = True
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)

for a in list(bpy.data.actions):
    if a.name not in clips:
        bpy.data.actions.remove(a)
for o in list(bpy.data.objects):  # 3ds Max helpers (footsteps etc.)
    if o.type == "EMPTY":
        bpy.data.objects.remove(o, do_unlink=True)

# one NLA track per clip, so the exporter writes each as its own animation
arm.animation_data_create()
for name in clips:
    act = bpy.data.actions[name]
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(act.frame_range[0]), act)
arm.animation_data.action = None

# 3ds Max shininess comes in as glossy plastic: skin and cloth are matte
for m in bpy.data.materials:
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
    if bsdf:
        for link in list(bsdf.inputs["Roughness"].links) + list(bsdf.inputs["Specular IOR Level"].links):
            m.node_tree.links.remove(link)
        bsdf.inputs["Roughness"].default_value = 0.62
        bsdf.inputs["Specular IOR Level"].default_value = 0.35
        bsdf.inputs["Metallic"].default_value = 0.0
    if "opacity" in m.name:  # hair and eyelashes: cut-out rather than sorted transparency
        m.blend_method = "HASHED"

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animation_mode="NLA_TRACKS",
                          export_image_format="AUTO", export_yup=True)
print("wrote", out, "clips:", ", ".join(clips))
