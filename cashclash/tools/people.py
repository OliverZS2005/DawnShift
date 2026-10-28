# Blender script: turns one Microsoft Rocketbox avatar (FBX, MIT licence) plus Rocketbox animation
# FBXs into a single glTF binary the web and desktop versions can both load. fetch-assets.mjs runs it:
#   blender -b --python tools/people.py -- <avatar.fbx> <out.glb> <clip>=<animation.fbx> ...
# The animations use the same "Bip01" skeleton as the avatar, so each one is retargeted onto it and
# exported as a named clip. Horizontal root motion is already stripped (Rocketbox "motextr_xy").
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

scene = bpy.context.scene
for name, path in clips.items():
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.fbx(filepath=path)
    new = [bpy.data.objects[n] for n in set(bpy.data.objects.keys()) - before]
    src = next(o for o in new if o.type == "ARMATURE")
    sact = src.animation_data.action
    for fc in list(sact.fcurves):  # keep bone curves only (not the helper object's own movement)
        if not fc.data_path.startswith("pose.bones"):
            sact.fcurves.remove(fc)
    f0, f1 = int(sact.frame_range[0]), int(sact.frame_range[1])
    # Retarget rather than copy the curves: the animation files' skeletons rest with the arms down and
    # the avatars' with them out, and curves are relative to each skeleton's own rest pose. So each bone
    # of the avatar copies the world rotation of the same bone in the animation (the root its position
    # too), and that is baked, frame by frame, into a new action.
    for pb in arm.pose.bones:
        if pb.name not in src.pose.bones:
            continue
        c = pb.constraints.new("COPY_ROTATION")
        c.target, c.subtarget, c.target_space, c.owner_space = src, pb.name, "WORLD", "WORLD"
        if pb.parent is None:
            c = pb.constraints.new("COPY_LOCATION")
            c.target, c.subtarget, c.target_space, c.owner_space = src, pb.name, "WORLD", "WORLD"
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.animation_data_create()
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False, visual_keying=True, clear_constraints=True,
                     use_current_action=False, bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    act = arm.animation_data.action
    act.name = name
    act.use_fake_user = True
    arm.animation_data.action = None
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
