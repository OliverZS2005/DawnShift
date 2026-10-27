# First-person 3D fight view for the desktop app: your weapon in hand, the opponent as an animated
# fighter, photo-textured map themes with decorations, tracers, muzzle flashes and explosions.
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
const TWIST = 1.15 # most the opponent's upper body turns from the legs to aim (radians, about 65 degrees)
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
			if ch.has("fall"):
				ch.fall.rotation.z = 0; ch.fall.position.x = 0; ch.gun_holder.visible = true
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
	floor.material_override = R3D.pbr(th.floorTex, Color(th.get("floorTint", "#ffffff")), float(th.floorTile), 0.0, Color("#6e6a63"))
	map_root.add_child(floor)
	# a paved courtyard around the arena, walled in by city blocks
	var clear = R3D.M.URBAN.arena.clear
	var apron = MeshInstance3D.new()
	var om = PlaneMesh.new(); om.size = Vector2(2 * clear[0], 2 * clear[1])
	apron.mesh = om
	apron.position.y = -0.02
	apron.material_override = R3D.pbr(th.outerTex, Color("#bbbbbb"), 5.0, 0.0, Color("#4a4a48"))
	map_root.add_child(apron)
	map_root.add_child(R3D.city("arena", th.lampsOn))
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
		if d.has("s"):
			o.scale *= float(d.s)
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

# ---------- People (the opponent) ----------
# Photoreal Rocketbox people. Their legs run where they're going; the upper body twists to where they aim
# and both arms reach for the gun, held out in front of the chest (posed in code after the animation each
# frame, the way GTA does it). They fall when they die. Mirrors makeCharacter()/poseAim() in render3d.js.
func _find(n: Node, cls: String):
	for c in n.find_children("*", cls, true, false):
		return c
	return null

# Same opponent, same person: picked from their name (same hash as personFor() in render3d.js).
func _person_for(name: String) -> String:
	var h = 7
	for i in name.length():
		h = (h * 31 + name.unicode_at(i)) & 0xFFFFFFFF
	if h >= 0x80000000:
		h -= 0x100000000
	var people = R3D.M.ASSETS.fighter.people
	return people[abs(h) % people.size()]

func _make_char(team: int, who: String) -> Dictionary:
	var root = Node3D.new()
	var ch = {"root": root, "team": team, "who": who, "anim": null, "clips": {}, "current": "", "gun_holder": Node3D.new(), "gun": null, "gun_id": "",
		"hit_t": 0.0, "flash_t": 0.0, "recoil": 0.0, "prev": null, "dead": false, "death_t": 0.0, "legs": 0.0, "last_hp": -1, "last_ammo": -1, "last_gun": ""}
	# glowing team ring under the feet
	var ring = MeshInstance3D.new()
	var tm = TorusMesh.new(); tm.inner_radius = 0.42; tm.outer_radius = 0.54; tm.rings = 40
	ring.mesh = tm
	ring.scale.y = 0.05
	ring.position.y = 0.03
	ring.material_override = R3D.flat(R3D.TEAM[team], 0.5, 0.0, R3D.TEAM[team], 3.0)
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(ring)
	root.add_child(ch.gun_holder)
	var ps = R3D.scene(R3D.M.ASSETS.characters[who])
	if ps == null: # fallback: the procedural soldier
		var b = R3D.build(R3D.M.SOLDIER, R3D.TEAM[team])
		root.add_child(b.root)
		ch.gun_holder.queue_free()
		ch.gun_holder = b.groups.gun
		ch.legs_groups = b.groups
		ch.procedural = true
		return ch
	# body (turned to where the legs go) > fall (tips over on death) > model
	var body = Node3D.new()
	var fall = Node3D.new()
	var model: Node3D = ps.instantiate()
	root.add_child(body); body.add_child(fall); fall.add_child(model)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	ch.body = body; ch.fall = fall; ch.model = model
	ch.skel = _find(model, "Skeleton3D")
	ch.needs_setup = true
	var F = R3D.M.ASSETS.fighter
	var sk: Skeleton3D = ch.skel
	if sk:
		var ids = func(names): return names.map(func(n): return sk.find_bone(n))
		ch.bones = {"spine": ids.call(F.bones.spine), "head": sk.find_bone(F.bones.head), "R": ids.call(F.bones.R), "L": ids.call(F.bones.L),
			"fingerR": sk.find_bone("Bip01 R Finger2"), "fingerL": sk.find_bone("Bip01 L Finger2")}
	var ap: AnimationPlayer = _find(model, "AnimationPlayer")
	if ap:
		ch.anim = ap
		ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL # stepped in update(), then posed
		for key in ["idle", "run", "walk"]:
			for nm in ap.get_animation_list():
				if nm == key or nm.ends_with("|" + key) or nm.ends_with("/" + key):
					ch.clips[key] = nm
					ap.get_animation(nm).loop_mode = Animation.LOOP_LINEAR
		_play(ch, "idle", 0.0)
	return ch

# First frame in the scene: turn the model to face +X (the game's forward). Its right is from the left
# shoulder to the right one.
func _setup_person(ch: Dictionary) -> void:
	ch.needs_setup = false
	var sk: Skeleton3D = ch.skel
	if sk == null or not ch.has("bones") or ch.bones.R[0] < 0:
		return
	if ch.anim:
		ch.anim.advance(0.0)
	var r = sk.global_transform * _bp(sk, ch.bones.R[0])
	var l = sk.global_transform * _bp(sk, ch.bones.L[0])
	var fwd = Vector3.UP.cross(Vector3(r.x - l.x, 0, r.z - l.z).normalized())
	ch.model.rotation.y = atan2(fwd.z, fwd.x)

func _play(ch: Dictionary, key: String, blend := 0.2) -> void:
	if ch.anim == null or not ch.clips.has(key) or ch.current == key:
		return
	ch.anim.play(ch.clips[key], blend)
	ch.current = key

# ----- posing helpers (skeleton space) -----
func _bp(sk: Skeleton3D, b: int) -> Vector3:
	return sk.get_bone_global_pose(b).origin

func _turn_bone(sk: Skeleton3D, b: int, q: Quaternion) -> void: # rotate bone b by q
	var t = sk.get_bone_global_pose(b)
	t.basis = Basis(q) * t.basis
	sk.set_bone_global_pose(b, t)

func _point_bone(sk: Skeleton3D, b: int, child: int, target: Vector3) -> void: # child onto the line to target
	var o = _bp(sk, b)
	var d = (_bp(sk, child) - o).normalized()
	var t = (target - o).normalized()
	if d.dot(t) < 0.99999:
		_turn_bone(sk, b, Quaternion(d, t))

# Two-bone arm: upper arm, forearm and wrist reach `target`, elbow bending towards `pole`.
func _reach(sk: Skeleton3D, arm: Array, target: Vector3, pole: Vector3) -> void:
	var s = _bp(sk, arm[0])
	var a = _bp(sk, arm[1]).distance_to(s)
	var b = _bp(sk, arm[2]).distance_to(_bp(sk, arm[1]))
	var dir = target - s
	var c = min(dir.length(), (a + b) * 0.999)
	dir = dir.normalized()
	var x = (a * a - b * b + c * c) / (2 * c)
	var y = sqrt(max(0.0, a * a - x * x))
	var bend = pole - s
	bend = (bend - dir * bend.dot(dir)).normalized()
	_point_bone(sk, arm[0], arm[1], s + dir * x + bend * y)
	_point_bone(sk, arm[1], arm[2], s + dir * c)

# After the animation: twist the spine from where the legs face to the aim, hold the gun out in front of
# the chest and put both hands on it. `aim` is the game angle (0 = +X).
func _pose_aim(ch: Dictionary, aim: float, recoil: float) -> void:
	var sk: Skeleton3D = ch.skel
	var B = ch.bones
	if B.spine[2] < 0 or B.R[2] < 0:
		return
	var F = R3D.M.ASSETS.fighter
	var xf = sk.global_transform
	var inv = xf.affine_inverse()
	var up = (inv.basis * Vector3.UP).normalized()
	var twist = clamp(wrapf(aim - ch.legs, -PI, PI), -TWIST, TWIST)
	for b in B.spine:
		_turn_bone(sk, b, Quaternion(up, -twist / 3))
	var d = Vector3(cos(aim), 0, sin(aim))
	var rt = Vector3(-sin(aim), 0, cos(aim))
	var chest = xf * _bp(sk, B.spine[2])
	var hold = F.hold.get(ch.gun_id, F.hold.pistol)
	var length = float(F.gunLen.get(ch.gun_id, 0.4))
	var grip = chest + d * (hold[0] - recoil * 0.06) + Vector3.UP * (-hold[1] + 0.12) + rt * hold[2]
	# the gun: grip at `grip`, barrel along the aim
	ch.gun_holder.position = grip - ch.root.position
	ch.gun_holder.rotation = Vector3(0, -aim - PI / 2, 0)
	ch.gun_holder.rotate_object_local(Vector3.RIGHT, recoil * 0.12)
	_reach(sk, B.R, inv * (grip - d * 0.07), inv * (chest + Vector3.DOWN * 0.7 + rt * 0.6))
	var support = grip - rt * 0.06 - d * 0.02 if ch.gun_id == "pistol" else grip + d * (length * 0.42) - Vector3.UP * 0.03
	_reach(sk, B.L, inv * support, inv * (chest + Vector3.DOWN * 0.7 - rt * 0.6))
	# hands line up with the gun
	if B.fingerR >= 0:
		_point_bone(sk, B.R[2], B.fingerR, inv * (xf * _bp(sk, B.R[2]) + d + Vector3.DOWN * 0.25))
	if B.fingerL >= 0:
		_point_bone(sk, B.L[2], B.fingerL, inv * (xf * _bp(sk, B.L[2]) + d * 0.6 + rt * 0.6))
	if B.head >= 0:
		_turn_bone(sk, B.head, Quaternion(up, -wrapf(aim - ch.legs - twist, -PI, PI) * 0.5))

# Fallback weapon (used only when the character model couldn't load).
func _make_gun(id: String) -> Node3D:
	var pb = R3D.build(R3D.M.GUNS[id])
	pb.root.set_meta("len", {"pistol": 0.25, "smg": 0.5, "shotgun": 0.75, "sniper": 1.0, "rocket": 1.0}[id])
	return pb.root

func _ensure_char(team: int, who: String) -> Dictionary:
	if chars[team] != null and chars[team].who != who and not chars[team].get("procedural", false):
		chars[team].root.queue_free(); chars[team].flash.queue_free(); chars[team].flare.queue_free()
		chars[team] = null
	if chars[team] == null:
		var ch = _make_char(team, who)
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
# A realistic gun model, already turned so its barrel points down -Z (the camera's forward), sights up.
# Same as makeViewmodel() in ../render3d.js.
func _set_viewmodel(id: String) -> void:
	vm_id = id
	raise_k = 0.0
	var wrap = _posed_gun(id, VM_LEN[id])
	if vm_id != id:
		wrap.queue_free()
		return
	for mi in wrap.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if vm_gun:
		vm_gun.queue_free()
	vm_gun = wrap
	vm_hold.add_child(wrap)

# Puts the equipped gun in the opponent's hand (the same models as the first-person view).
func _set_fighter_gun(ch: Dictionary, id: String) -> void:
	var length = float(R3D.M.ASSETS.fighter.gunLen[id])
	var gun = _posed_gun(id, length)
	if ch.gun_id != id or not is_instance_valid(ch.gun_holder):
		gun.queue_free()
		return
	if ch.gun:
		ch.gun.queue_free()
	gun.position = Vector3(0, 0.04, -length * 0.3) # grip in the hand, barrel ahead
	ch.gun = gun
	ch.gun_holder.add_child(gun)

# A gun model with its barrel down -Z, centred and scaled to `length` metres.
func _posed_gun(id: String, length: float) -> Node3D:
	var wrap = Node3D.new()
	var orient = Node3D.new()
	wrap.add_child(orient)
	var ps = R3D.scene(R3D.M.ASSETS.guns[id])
	var gun: Node3D = null
	if ps:
		gun = ps.instantiate()
		orient.add_child(gun)
	if gun == null: # fallback: procedural gun (built facing +X)
		gun = R3D.build(R3D.M.GUNS[id]).root
		orient.add_child(gun)
		orient.rotation.y = PI / 2
	var box = R3D.aabb(wrap)
	orient.position = -box.get_center()
	var k = length / max(0.001, max(box.size.x, max(box.size.y, box.size.z)))
	wrap.scale = Vector3.ONE * k
	wrap.set_meta("len", length)
	wrap.set_meta("h", box.size.y * k)
	return wrap

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
	# ----- the opponent: a person who runs, aims and falls -----
	var s = view.u[1 - you]
	var ch = _ensure_char(1, _person_for(str(names[1])))
	var wp = to_world(float(s.x), float(s.y))
	if ch.get("needs_setup", false):
		_setup_person(ch)
	if ch.gun_id != s.g.id:
		ch.gun_id = s.g.id
		if ch.has("model"):
			_set_fighter_gun(ch, s.g.id)
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
	var e_shot = ch.last_ammo >= 0 and int(s.g.ammo) < ch.last_ammo and s.g.id == ch.last_gun
	var e_hurt = ch.last_hp >= 0 and int(s.hp) < ch.last_hp
	ch.last_ammo = int(s.g.ammo); ch.last_gun = s.g.id; ch.last_hp = int(s.hp)
	if e_shot:
		ch.flash_t = 0.055; ch.recoil = 1.0
	if e_hurt: # a puff of blood from the chest
		ch.hit_t = 0.14
		events.hit_enemy = true
		var c = wp + Vector3(0, 1.3, 0)
		if ch.has("bones") and ch.bones.spine[2] >= 0:
			c = ch.skel.global_transform * _bp(ch.skel, ch.bones.spine[2])
		_puff(c, Color("#5a0b0b"), 0.32, 0.35, 0.15)
	ch.flash_t -= dt; ch.hit_t -= dt; ch.recoil = max(0.0, ch.recoil - dt * 7)
	if ch.get("procedural", false):
		ch.root.rotation.y = -float(s.ang)
		ch.root.rotation.z = PI / 2 * 0.95 if int(s.hp) <= 0 else 0.0
	elif int(s.hp) <= 0:
		# falls backwards like a dead weight (Rocketbox has no death animation); the gun drops
		if not ch.dead:
			ch.dead = true
			ch.death_t = 0.0
		ch.death_t += dt
		var k = min(1.0, ch.death_t / 0.7)
		ch.fall.rotation.z = k * k * PI / 2 * 0.97
		ch.fall.position.x = -k * k * 0.12
		if ch.death_t < 0.35 and ch.anim:
			ch.anim.advance(dt * 0.5)
		ch.gun_holder.visible = ch.death_t < 0.12
	else:
		if ch.dead:
			ch.dead = false
			ch.fall.rotation.z = 0; ch.fall.position.x = 0; ch.gun_holder.visible = true
		# legs go where they're moving, but the upper body only twists so far to keep aiming (no strafe
		# clips): moving sideways, the legs point partway between the two; moving away from the aim, they
		# backpedal. Standing still, the feet only turn once the body would twist too far.
		var legs_to = ch.legs
		if moving:
			var mv = atan2(vel.z, vel.x)
			var rel = wrapf(mv - float(s.ang), -PI, PI)
			var back = abs(rel) > 1.95
			var key = "run" if sp > 2.6 else "walk"
			legs_to = float(s.ang) + (clamp(wrapf(mv + PI - float(s.ang), -PI, PI), -TWIST, TWIST) if back else clamp(rel, -TWIST, TWIST))
			_play(ch, key if ch.clips.has(key) else "run")
			if ch.anim:
				ch.anim.speed_scale = (-1.0 if back else 1.0) * clamp(sp / (4.4 if key == "run" else 1.5), 0.6, 1.4)
		else:
			if abs(wrapf(float(s.ang) - ch.legs, -PI, PI)) > 0.9:
				legs_to = float(s.ang)
			_play(ch, "idle")
			if ch.anim:
				ch.anim.speed_scale = 1.0
		ch.legs += wrapf(legs_to - ch.legs, -PI, PI) * min(1.0, dt * 8)
		if ch.anim:
			ch.anim.advance(dt)
		ch.body.rotation.y = -ch.legs
		if ch.skel and ch.has("bones"):
			_pose_aim(ch, float(s.ang), ch.recoil)
	var fwd3 = Vector3(cos(float(s.ang)), 0, sin(float(s.ang)))
	var muzzle = wp + fwd3 * 0.8 + Vector3(0, 1.3, 0)
	if ch.gun and ch.gun.is_inside_tree():
		if ch.has("model"): # posed guns point down -Z
			muzzle = ch.gun.global_position - ch.gun.global_basis.z.normalized() * float(ch.gun.get_meta("len", 0.4)) * 0.5
		else:
			muzzle = ch.gun.global_position + fwd3 * float(ch.gun.get_meta("len", 0.4))
	ch.flash.position = muzzle; ch.flare.position = muzzle
	ch.flash.light_energy = 4.0 if ch.flash_t > 0 else 0.0
	ch.flare.visible = ch.flash_t > 0
	ch.flare.scale = Vector3.ONE * (0.55 + randf() * 0.45)
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
