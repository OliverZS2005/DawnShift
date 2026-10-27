# First-person 3D fight view for the desktop app: your weapon in hand, the opponent as an animated
# soldier, photo-textured map themes with decorations, tracers, muzzle flashes and explosions.
# Mirrors createArena() in ../render3d.js; layout data comes from models.json.
extends Control

var v: Dictionary
var map_index := -1
var map_root: Node3D
var sun_light: DirectionalLight3D
var chars := [null, null]
var tracers := []
var puffs := []
var seen := []
var boom_light: OmniLight3D
var shake := 0.0
var S: float
const EYE = 1.62
# what happened this frame, for the HUD (hit marker, damage flash)
var events := {"hit_enemy": false, "hurt": false, "shot": false}
# you: camera + held weapon
var me := {"last_ammo": -1, "last_gun": "", "last_hp": -1, "prev": null}
var eye := EYE
var roll := 0.0
var kick := 0.0
var walk := 0.0
var sway := 0.0
var last_yaw = null
var reload_k := 0.0
var raise_k := 1.0
var vm_root: Node3D   # child of the camera, everything at 1/5 scale so the gun never pokes into walls
var vm_hold: Node3D
var vm_gun: Node3D = null
var vm_id := ""
var vm_flare: MeshInstance3D
var vm_flare_t := 0.0
var my_flash: OmniLight3D
const VM_SCALE = 0.2
const VM_LEN = {"pistol": 0.24, "smg": 0.44, "shotgun": 0.62, "sniper": 0.62, "rocket": 0.62}

func _init() -> void:
	v = R3D.viewport(45.0)
	v.container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v.container)
	S = float(R3D.M.ARENA.scale)
	boom_light = OmniLight3D.new()
	boom_light.light_color = Color("#ff8a3a")
	boom_light.omni_range = 14
	boom_light.light_energy = 0
	v.world.add_child(boom_light)
	v.camera.fov = 64.0
	v.camera.near = 0.01
	v.camera.rotation_order = EULER_ORDER_YXZ
	my_flash = OmniLight3D.new()
	my_flash.light_color = Color("#ffc46b"); my_flash.omni_range = 8; my_flash.light_energy = 0
	v.world.add_child(my_flash)
	vm_root = Node3D.new()
	vm_root.scale = Vector3.ONE * VM_SCALE
	v.camera.add_child(vm_root)
	vm_hold = Node3D.new()
	vm_root.add_child(vm_hold)
	vm_flare = MeshInstance3D.new()
	var fm = SphereMesh.new(); fm.radius = 0.04; fm.height = 0.08
	vm_flare.mesh = fm
	vm_flare.material_override = R3D.flat(Color("#ffd27a"), 1.0, 0.0, Color("#ffd27a"), 10.0)
	vm_flare.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	vm_flare.visible = false
	vm_root.add_child(vm_flare)

func to_world(x: float, y: float) -> Vector3:
	return Vector3(x * S - 22.5, 0, y * S - 14)

func reset() -> void:
	me = {"last_ammo": -1, "last_gun": "", "last_hp": -1, "prev": null}
	eye = EYE; roll = 0.0; kick = 0.0; last_yaw = null; shake = 0.0
	for ch in chars:
		if ch:
			ch.prev = null
			ch.dead = false
			ch.last_hp = -1
			ch.last_ammo = -1
			if ch.anim:
				_play(ch, "idle", 0.0)

# ---------- Map ----------
func _build_map(m: int) -> void:
	map_index = m
	if map_root:
		map_root.queue_free()
	map_root = Node3D.new()
	v.world.add_child(map_root)
	var th = R3D.M.ARENA.themes[m]
	var walls = CC.MAPS[m].walls
	var hh = float(R3D.M.ARENA.wallHeight)
	v.env.environment = R3D.environment(th.sky, th.exposure, Color(th.sun) * 0.35)
	if sun_light:
		sun_light.queue_free()
	sun_light = R3D.sun(Color(th.sun), float(th.sunI))
	map_root.add_child(sun_light)
	# floors
	var floor = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size = Vector2(45, 28)
	floor.mesh = pm
	floor.material_override = R3D.pbr(th.floorTex, Color.WHITE, float(th.floorTile), 0.0, Color("#6e6a63"))
	map_root.add_child(floor)
	var outer = MeshInstance3D.new()
	var om = PlaneMesh.new(); om.size = Vector2(240, 240)
	outer.mesh = om
	outer.position.y = -0.03
	outer.material_override = R3D.pbr(th.outerTex, Color("#bbbbbb"), 5.0, 0.0, Color("#4a4a48"))
	map_root.add_child(outer)
	var line = R3D.flat(Color(th.line), 0.55)
	for e in [[45, 0.14, 0, -13.93], [45, 0.14, 0, 13.93], [0.14, 28, -22.43, 0], [0.14, 28, 22.43, 0]]:
		map_root.add_child(R3D.box(Vector3(e[0], 0.012, e[1]), line, Vector3(e[2], 0.007, e[3])))
	var curb = R3D.pbr("concrete_wall", Color("#c9c4bb"), 3.0, 0.0, Color("#8a8680"))
	for e in [[46.2, 0.5, 0, -14.3], [46.2, 0.5, 0, 14.3], [0.5, 29.1, -22.85, 0], [0.5, 29.1, 22.85, 0]]:
		map_root.add_child(R3D.box(Vector3(e[0], 0.7, e[1]), curb, Vector3(e[2], 0.35, e[3])))
	# cover walls
	var trim = R3D.flat(Color(th.trim), 0.3, 1.0 if th.wallStyle == "marble" else 0.6)
	var neon = R3D.flat(Color(th.trim), 0.3, 0.0, Color(th.trim), 4.0)
	for i in walls.size():
		var w = walls[i]
		var c = to_world(w[0] + w[2] / 2.0, w[1] + w[3] / 2.0)
		var W = w[2] * S
		var D = w[3] * S
		if th.wallStyle == "containers" and W <= 3.2 and D <= 3.2:
			_stack_crates(c, W, D)
			continue
		var tint = Color(th.tints[i % th.tints.size()])
		var metal = 0.5 if th.wallStyle in ["metal", "containers"] else 0.0
		map_root.add_child(R3D.box(Vector3(W, hh, D), R3D.pbr(th.wallTex, tint, float(th.wallTile), metal, tint), c + Vector3(0, hh / 2, 0)))
		if th.wallStyle == "containers": # steel frame: corner posts + rails
			for sx in [-1, 1]:
				for sz in [-1, 1]:
					map_root.add_child(R3D.box(Vector3(0.14, hh, 0.14), trim, c + Vector3(sx * (W / 2 - 0.05), hh / 2, sz * (D / 2 - 0.05))))
			map_root.add_child(R3D.box(Vector3(W + 0.04, 0.12, D + 0.04), trim, c + Vector3(0, hh - 0.04, 0)))
			map_root.add_child(R3D.box(Vector3(W + 0.04, 0.12, D + 0.04), trim, c + Vector3(0, 0.06, 0)))
		elif th.wallStyle == "metal":
			map_root.add_child(R3D.box(Vector3(W + 0.03, 0.05, D + 0.03), neon, c + Vector3(0, 0.35, 0)))
			map_root.add_child(R3D.box(Vector3(W + 0.03, 0.05, D + 0.03), neon, c + Vector3(0, hh - 0.25, 0)))
			map_root.add_child(R3D.box(Vector3(W + 0.1, 0.1, D + 0.1), trim, c + Vector3(0, hh + 0.05, 0)))
		else:
			map_root.add_child(R3D.box(Vector3(W + 0.16, 0.14, D + 0.16), trim, c + Vector3(0, hh + 0.07, 0)))
			map_root.add_child(R3D.box(Vector3(W + 0.1, 0.18, D + 0.1), trim, c + Vector3(0, 0.09, 0)))
	# decorations outside the play area; street lamps light up on night/dusk maps
	var lights = 0
	for d in th.decor:
		var o = R3D.prop(d.model)
		if o == null:
			continue
		o.position = Vector3(d.p[0], d.p[1], d.p[2])
		o.rotation.y = d.ry
		map_root.add_child(o)
		if d.get("light", false) and th.lampsOn and lights < 6:
			lights += 1
			var l = OmniLight3D.new()
			l.light_color = Color("#ffd8a0"); l.light_energy = 3.0; l.omni_range = 22
			l.position = Vector3(d.p[0], 5.2, d.p[2])
			map_root.add_child(l)
	R3D.shadows(map_root)

# Small Warehouse cover blocks become stacks of wooden crates that fill the block.
func _stack_crates(c: Vector3, W: float, D: float) -> void:
	var probe = R3D.prop("crate")
	if probe == null:
		map_root.add_child(R3D.box(Vector3(W, 2.6, D), R3D.pbr("corrugated"), c + Vector3(0, 1.3, 0)))
		return
	var size = R3D.aabb(probe).size
	probe.free()
	var nx = maxi(1, roundi(W / 1.2))
	var nz = maxi(1, roundi(D / 1.2))
	var cx = W / nx
	var cz = D / nz
	for i in nx:
		for k in nz:
			for lv in 2:
				var o = R3D.prop("crate")
				o.scale = Vector3(cx * 0.98 / size.x, 1.25 * 0.98 / size.y, cz * 0.98 / size.z)
				o.position = c + Vector3(-W / 2 + cx * (i + 0.5), lv * 1.25, -D / 2 + cz * (k + 0.5))
				o.rotation.y = ((i + k + lv) % 2) * PI
				map_root.add_child(o)

# ---------- Characters ----------
func _find(n: Node, cls: String):
	for c in n.find_children("*", cls, true, false):
		return c
	return null

func _make_char(team: int) -> Dictionary:
	var root = Node3D.new()
	var ch = {"root": root, "team": team, "anim": null, "clips": {}, "current": "", "gun_holder": null, "gun": null, "gun_id": "",
		"mats": [], "hit_t": 0.0, "flash_t": 0.0, "shoot_t": 0.0, "prev": null, "dead": false, "last_hp": -1, "last_ammo": -1, "last_gun": ""}
	# glowing team ring under the feet
	var ring = MeshInstance3D.new()
	var tm = TorusMesh.new(); tm.inner_radius = 0.42; tm.outer_radius = 0.54; tm.rings = 40
	ring.mesh = tm
	ring.scale.y = 0.05
	ring.position.y = 0.03
	ring.material_override = R3D.flat(R3D.TEAM[team], 0.5, 0.0, R3D.TEAM[team], 3.0)
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(ring)
	var ps = R3D.scene(R3D.M.ASSETS.characters.soldier)
	if ps == null: # fallback: the procedural soldier
		var b = R3D.build(R3D.M.SOLDIER, R3D.TEAM[team])
		root.add_child(b.root)
		ch.gun_holder = b.groups.gun
		ch.legs = b.groups
		return ch
	var model: Node3D = ps.instantiate()
	model.rotation.y = PI / 2 # Quaternius characters face +Z; the game's forward is +X
	root.add_child(model)
	# The model carries a whole armory in its hands: hide it all; the equipped one is shown in update().
	ch.gear = {}
	for gname in R3D.M.ASSETS.characterGear:
		var found = model.find_children(gname, "", true, false)
		if found.size():
			ch.gear[gname] = found[0]
			found[0].visible = false
	# Per-fighter materials; the uniform is dyed in the team colour.
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for s in mi.mesh.get_surface_count():
			var m = mi.get_active_material(s)
			if m == null:
				continue
			m = m.duplicate()
			mi.set_surface_override_material(s, m)
			ch.mats.append(m)
			if str(m.resource_name) in R3D.M.ASSETS.uniform:
				m.albedo_color = m.albedo_color.lerp(R3D.TEAM[team], 0.8)
	# Sized once it's in the scene (see _fit_height): skinned meshes report misleading bounds.
	ch.model = model
	ch.skel = _find(model, "Skeleton3D")
	ch.needs_fit = true
	# animations: find clips by name suffix (e.g. "CharacterArmature|Run_Gun")
	var ap: AnimationPlayer = _find(model, "AnimationPlayer")
	if ap:
		ch.anim = ap
		for key in R3D.M.ASSETS.clips:
			var want = R3D.M.ASSETS.clips[key]
			for nm in ap.get_animation_list():
				if nm == want or nm.ends_with("|" + want) or nm.ends_with("/" + want):
					ch.clips[key] = nm
					ap.get_animation(nm).loop_mode = Animation.LOOP_NONE if key in ["hit", "death"] else Animation.LOOP_LINEAR
		if not ch.clips.has("idle") and ch.clips.has("idleAlt"): ch.clips.idle = ch.clips.idleAlt
		if not ch.clips.has("run") and ch.clips.has("runAlt"): ch.clips.run = ch.clips.runAlt
		_play(ch, "idle", 0.0)
	return ch

# Scales the character so its head bone sits at an adult's head height (feet to head base ~1.5 m).
func _fit_height(ch: Dictionary) -> void:
	ch.needs_fit = false
	var sk: Skeleton3D = ch.skel
	if sk == null:
		return
	var hb = sk.find_bone("Head")
	var fb = sk.find_bone("FootL")
	if hb < 0 or fb < 0:
		return
	var d = (sk.global_transform * sk.get_bone_global_pose(hb)).origin.y - (sk.global_transform * sk.get_bone_global_pose(fb)).origin.y
	if d > 0.0001:
		ch.model.scale *= 1.5 / d

func _play(ch: Dictionary, key: String, blend := 0.18) -> void:
	if ch.anim == null or not ch.clips.has(key) or ch.current == key:
		return
	ch.anim.play(ch.clips[key], blend)
	ch.current = key

# Fallback weapon (used only when the character model couldn't load).
func _make_gun(id: String) -> Node3D:
	var pb = R3D.build(R3D.M.GUNS[id])
	pb.root.set_meta("len", {"pistol": 0.25, "smg": 0.5, "shotgun": 0.75, "sniper": 1.0, "rocket": 1.0}[id])
	return pb.root

func _ensure_char(team: int) -> Dictionary:
	if chars[team] == null:
		var ch = _make_char(team)
		ch.label = Label3D.new()
		ch.label.font = R3D.font("barlow-condensed-600")
		ch.label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		ch.label.no_depth_test = true
		ch.label.font_size = 40
		ch.label.outline_size = 10
		ch.label.pixel_size = 0.006
		ch.label.position.y = 2.6
		ch.root.add_child(ch.label)
		# health bar: a dark back plate and a fill that shrinks from the right
		ch.bar_bg = _bar_quad(Vector2(1.5, 0.17), Color(0, 0, 0, 0.65), 0.0)
		ch.bar_bg.position = Vector3(0, 2.3, 0)
		ch.root.add_child(ch.bar_bg)
		ch.bar = _bar_quad(Vector2(1.44, 0.11), Color("#4ade80"), 0.72)
		ch.bar.position = Vector3(-0.72, 2.3, 0.01)
		ch.root.add_child(ch.bar)
		ch.flash = OmniLight3D.new()
		ch.flash.light_color = Color("#ffc46b"); ch.flash.omni_range = 7; ch.flash.light_energy = 0
		v.world.add_child(ch.flash)
		ch.flare = MeshInstance3D.new()
		var sm = SphereMesh.new(); sm.radius = 0.16; sm.height = 0.32
		ch.flare.mesh = sm
		ch.flare.material_override = R3D.flat(Color("#ffd27a"), 1.0, 0.0, Color("#ffd27a"), 8.0)
		ch.flare.visible = false
		v.world.add_child(ch.flare)
		v.world.add_child(ch.root)
		chars[team] = ch
	return chars[team]

# Camera-facing quad that ignores lighting; `pivot` shifts it so it scales from its left edge.
func _bar_quad(size: Vector2, color: Color, pivot: float) -> MeshInstance3D:
	var mi = MeshInstance3D.new()
	var q = QuadMesh.new()
	q.size = size
	q.center_offset = Vector3(pivot, 0, 0)
	mi.mesh = q
	var m = StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.no_depth_test = true
	m.render_priority = 2 if pivot > 0 else 1
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = color
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func _puff(pos: Vector3, color: Color, size: float, life: float, rise: float) -> void:
	var p = null
	for q in puffs:
		if not q.node.visible:
			p = q
			break
	if p == null:
		var mi = MeshInstance3D.new()
		var sm = SphereMesh.new(); sm.radius = 0.5; sm.height = 1.0; sm.radial_segments = 10; sm.rings = 6
		mi.mesh = sm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var m = StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mi.material_override = m
		v.world.add_child(mi)
		p = {"node": mi}
		puffs.append(p)
	p.node.material_override.albedo_color = color
	p.node.position = pos
	p.node.scale = Vector3.ONE * size
	p.node.visible = true
	p.t = 0.0; p.life = life; p.size = size
	p.vel = Vector3((randf() - 0.5) * 1.2, rise, (randf() - 0.5) * 1.2)

# ---------- First-person weapon ----------
# The soldier's own gun. We pose a soldier in his aiming animation, read how the gun sits relative to
# his body (he faces +Z), straighten its barrel (longest axis) to point exactly forward and turn it to
# the camera's forward (-Z). Same approach as makeViewmodel() in ../render3d.js.
func _set_viewmodel(id: String) -> void:
	vm_id = id
	raise_k = 0.0
	var wrap = Node3D.new()
	var orient = Node3D.new()
	wrap.add_child(orient)
	var ps = R3D.scene(R3D.M.ASSETS.characters.soldier)
	var gun: Node3D = null
	if ps:
		var body: Node3D = ps.instantiate()
		body.visible = false
		v.world.add_child(body)
		var ap: AnimationPlayer = _find(body, "AnimationPlayer")
		if ap:
			for nm in ap.get_animation_list():
				if nm.ends_with("|" + R3D.M.ASSETS.clips.shoot) or nm.ends_with("/" + R3D.M.ASSETS.clips.shoot):
					ap.play(nm)
					ap.seek(0.0, true)
		await get_tree().process_frame # let the skeleton and bone attachments take the pose
		await get_tree().process_frame
		var found = body.find_children(R3D.M.ASSETS.characterGuns[id], "", true, false)
		if found.size() and vm_id == id:
			var node: Node3D = found[0]
			var rel: Transform3D = body.global_transform.affine_inverse() * node.global_transform
			gun = node.duplicate()
			gun.visible = true
			gun.transform = Transform3D.IDENTITY
			var size = R3D.aabb(gun).size
			var along = Vector3.RIGHT if size.x >= size.y and size.x >= size.z else (Vector3.UP if size.y >= size.z else Vector3.BACK)
			var rot = rel.basis.orthonormalized()
			var d = (rot * along).normalized()
			if d.z < 0:
				d = -d
			gun.basis = Basis(Quaternion(d, Vector3.BACK)) * rot
			for mi in gun.find_children("*", "MeshInstance3D", true, false):
				mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			orient.add_child(gun)
			orient.rotation.y = PI # his forward (+Z) -> camera forward (-Z)
		body.queue_free()
	if vm_id != id:
		wrap.queue_free()
		return
	if gun == null: # fallback: procedural gun (built facing +X)
		gun = R3D.build(R3D.M.GUNS[id]).root
		orient.add_child(gun)
		orient.rotation.y = PI / 2
	var box = R3D.aabb(wrap)
	orient.position = -box.get_center()
	var k = VM_LEN[id] / max(0.001, max(box.size.x, max(box.size.y, box.size.z)))
	wrap.scale = Vector3.ONE * k
	wrap.set_meta("len", VM_LEN[id])
	wrap.set_meta("h", box.size.y * k)
	if vm_gun:
		vm_gun.queue_free()
	vm_gun = wrap
	vm_hold.add_child(wrap)

# Where the opponent's name tag goes on screen, or null when they're off-screen or behind you.
func foe_tag():
	var ch = chars[1]
	if ch == null:
		return null
	var head = ch.root.position + Vector3(0, 2.2, 0)
	if v.camera.is_position_behind(head):
		return null
	return v.camera.unproject_position(head)

# ---------- Per frame ----------
# view = {m, u: [{x,y,hp,mhp,ang,g:{id,ammo,rl}}], b: [[x,y,big,vx,vy]], fx: [[x,y,r,t]]}
# pitch: where you look up/down (visual only: the fight happens on a flat plane)
func update(view: Dictionary, you: int, names: Array, dt: float, pitch := 0.0, reduce_motion := false) -> void:
	events.hit_enemy = false; events.hurt = false; events.shot = false
	if int(view.m) != map_index:
		_build_map(int(view.m))
	# ----- you: the camera -----
	var s0 = view.u[you]
	var mp = to_world(float(s0.x), float(s0.y))
	var speed = 0.0 if me.prev == null else mp.distance_to(me.prev) / max(dt, 0.001)
	me.prev = mp
	var shot = me.last_ammo >= 0 and int(s0.g.ammo) < me.last_ammo and s0.g.id == me.last_gun
	var hurt = me.last_hp >= 0 and int(s0.hp) < me.last_hp
	me.last_ammo = int(s0.g.ammo); me.last_gun = s0.g.id; me.last_hp = int(s0.hp)
	if shot:
		events.shot = true
		kick = min(1.4, kick + {"sniper": 1.2, "rocket": 1.3, "shotgun": 1.1}.get(s0.g.id, 0.45))
		if s0.g.id in ["rocket", "shotgun"]:
			shake = max(shake, 0.06)
	if hurt:
		events.hurt = true
		shake = max(shake, 0.05)
	if vm_id != s0.g.id:
		_set_viewmodel(s0.g.id)
	var dead = int(s0.hp) <= 0
	eye += ((0.35 if dead else EYE) - eye) * min(1.0, dt * (3.0 if dead else 10.0))
	roll += ((0.5 if dead else 0.0) - roll) * min(1.0, dt * 3.0)
	walk += speed * dt * 1.9
	var bob = 0.0 if reduce_motion or speed < 0.6 else 1.0
	shake = max(0.0, shake - dt * 0.6)
	var jitter = 0.0 if reduce_motion else shake
	var ang = float(s0.ang)
	v.camera.position = Vector3(mp.x, eye + bob * abs(cos(walk)) * 0.045, mp.z)
	v.camera.rotation = Vector3(pitch + kick * 0.035 + (randf() - 0.5) * jitter, -ang - PI / 2 + (randf() - 0.5) * jitter, roll)
	# held weapon: bob, sway when turning, recoil, reload dip, raise when switching
	if last_yaw != null:
		sway = clamp(sway + wrapf(ang - last_yaw, -PI, PI) * 0.6, -0.08, 0.08)
	last_yaw = ang
	sway *= max(0.0, 1.0 - dt * 8); kick *= max(0.0, 1.0 - dt * 9); raise_k = min(1.0, raise_k + dt * 4)
	reload_k += ((1.0 if s0.g.rl else 0.0) - reload_k) * min(1.0, dt * 10)
	var gl = float(vm_gun.get_meta("len", 0.5)) if vm_gun else 0.5
	var gh = float(vm_gun.get_meta("h", 0.15)) if vm_gun else 0.15
	# the gun's top edge sits just under the crosshair line, out to the right
	vm_hold.position = Vector3(0.19 + gh * 0.2 + sway + bob * sin(walk) * 0.012, -0.1 - gh * 0.5 - (1 - raise_k) * 0.3 - reload_k * 0.12 + bob * abs(cos(walk)) * 0.01, -0.16 - gl * 0.5 + kick * 0.06)
	vm_hold.rotation = Vector3(kick * 0.12 - reload_k * 0.5, 0.05 + sway * 2, -reload_k * 0.6)
	vm_hold.visible = not dead
	vm_flare_t = 0.05 if shot else vm_flare_t - dt
	vm_flare.visible = vm_flare_t > 0 and not dead
	vm_flare.position = vm_hold.position + Vector3(0, 0.02, -gl * 0.55)
	vm_flare.scale = Vector3.ONE * (0.8 + randf() * 0.6)
	my_flash.position = mp + Vector3(cos(ang) * 0.9, EYE - 0.2, sin(ang) * 0.9)
	my_flash.light_energy = 4.0 if vm_flare.visible else 0.0
	# ----- the opponent: animated soldier -----
	var s = view.u[1 - you]
	var ch = _ensure_char(1)
	var wp = to_world(float(s.x), float(s.y))
	if ch.get("needs_fit", false):
		_fit_height(ch)
	if ch.gun_id != s.g.id:
		ch.gun_id = s.g.id
		if ch.has("gear"):
			for g in ch.gear.values():
				g.visible = false
			ch.gun = ch.gear.get(R3D.M.ASSETS.characterGuns[s.g.id])
			if ch.gun:
				ch.gun.visible = true
		else:
			if ch.gun:
				ch.gun.queue_free()
			ch.gun = _make_gun(s.g.id)
			ch.gun_holder.add_child(ch.gun)
	var vel = Vector3.ZERO if ch.prev == null else (wp - ch.prev) / max(dt, 0.001)
	ch.prev = wp
	var sp = vel.length()
	var moving = sp > 0.6
	ch.root.position = wp
	ch.root.rotation.y = -float(s.ang)
	var e_shot = ch.last_ammo >= 0 and int(s.g.ammo) < ch.last_ammo and s.g.id == ch.last_gun
	var e_hurt = ch.last_hp >= 0 and int(s.hp) < ch.last_hp
	ch.last_ammo = int(s.g.ammo); ch.last_gun = s.g.id; ch.last_hp = int(s.hp)
	if e_shot:
		ch.flash_t = 0.055; ch.shoot_t = 0.35
	if e_hurt:
		ch.hit_t = 0.14
		events.hit_enemy = true
	ch.flash_t -= dt; ch.hit_t -= dt; ch.shoot_t -= dt
	if int(s.hp) <= 0:
		if not ch.dead:
			ch.dead = true
			if ch.clips.has("death"): _play(ch, "death", 0.1)
			else: ch.root.rotation.z = PI / 2 * 0.95
	else:
		ch.dead = false
		_play(ch, "run" if moving else ("shoot" if ch.shoot_t > 0 and ch.clips.has("shoot") else "idle"))
		if ch.anim and ch.current == "run":
			var fwd = cos(float(s.ang)) * vel.x + sin(float(s.ang)) * vel.z
			ch.anim.speed_scale = (-1.0 if fwd < -0.3 * sp else 1.0) * min(1.35, sp / 4.0)
		elif ch.anim:
			ch.anim.speed_scale = 1.0
	for m in ch.mats:
		m.emission_enabled = ch.hit_t > 0
		m.emission = Color("#ff2020")
		m.emission_energy_multiplier = 0.45
	var fwd3 = Vector3(cos(float(s.ang)), 0, sin(float(s.ang)))
	var muzzle = wp + fwd3 * 0.8 + Vector3(0, 1.3, 0)
	if ch.gun and ch.gun.is_inside_tree():
		muzzle = ch.gun.global_position + fwd3 * (0.45 if ch.has("gear") else float(ch.gun.get_meta("len", 0.4)))
	ch.flash.position = muzzle; ch.flare.position = muzzle
	ch.flash.light_energy = 4.0 if ch.flash_t > 0 else 0.0
	ch.flare.visible = ch.flash_t > 0
	# the name/health tag is drawn by the HUD (see foe_tag()), so hide the 3D one
	ch.label.visible = false
	ch.bar.visible = false
	ch.bar_bg.visible = false
	# tracers and rockets
	for t in tracers:
		t.visible = false
	var n = 0
	for b in view.b:
		if n >= tracers.size():
			var mi = MeshInstance3D.new()
			var bm = BoxMesh.new(); bm.size = Vector3(1.1, 0.04, 0.04)
			mi.mesh = bm
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mi.material_override = R3D.flat(Color("#ffd27a"), 1.0, 0.0, Color("#ffd27a"), 6.0)
			v.world.add_child(mi)
			tracers.append(mi)
		var tr = tracers[n]
		n += 1
		var big = int(b[2]) == 1
		tr.position = to_world(float(b[0]), float(b[1])) + Vector3(0, 1.3, 0)
		tr.rotation.y = -atan2(float(b[4]) if b.size() > 4 else 0.0, float(b[3]) if b.size() > 3 else 1.0)
		tr.scale = Vector3(0.6, 3.0, 3.0) if big else Vector3.ONE
		tr.visible = true
		if big and randf() < 0.7:
			_puff(tr.position, Color(0.6, 0.6, 0.6, 0.7), 0.35, 0.9, 0.4)
	# explosions and impacts (particles spawn the first frame an effect appears)
	var boom = 0.0
	for f in view.fx:
		var fp = to_world(float(f[0]), float(f[1]))
		var big = float(f[2]) > 20
		var key = "%d,%d,%d" % [int(f[0]), int(f[1]), int(f[2])]
		if not key in seen:
			seen.append(key)
			if seen.size() > 60:
				seen.pop_front()
			if big:
				if fp.distance_to(mp) < 12:
					shake = max(shake, 0.12)
				for k in 14:
					_puff(fp + Vector3((randf() - 0.5) * 2, 0.6 + randf(), (randf() - 0.5) * 2), Color(1, 0.7, 0.3, 0.9) if k < 6 else Color(0.36, 0.35, 0.33, 0.8), 1.2 + randf() * 1.4, 0.6 + randf() * 0.9, 1.6)
			else:
				for k in 5:
					_puff(fp + Vector3(0, 1.3, 0), Color(1, 0.85, 0.5, 0.9), 0.12, 0.25, 2.5)
		if big:
			boom = max(boom, float(f[3]) * 3)
			boom_light.position = fp + Vector3(0, 1.5, 0)
	boom_light.light_energy = boom * 8
	for p in puffs:
		if p.node.visible:
			p.t += dt
			var k = p.t / p.life
			p.node.position += p.vel * dt
			p.node.scale = Vector3.ONE * p.size * (1 + k * 1.5)
			p.node.material_override.albedo_color.a = max(0.0, 1 - k) * 0.8
			if k >= 1:
				p.node.visible = false
	if sun_light:
		sun_light.position = mp
