# 3D tycoon city for the desktop app: 3x3 lots of buildings on textured streets with real street
# furniture, trees, lamps, a skyline that grows with your level, floating coins and the golden crate.
# Drag to orbit, scroll to zoom, click a lot to buy. Mirrors createCity() in ../render3d.js.
extends Control

signal lot_clicked(i: int)
signal crate_clicked

var v: Dictionary
var L: float
var lots := []
var world: Node3D
var coins := []
var crate = null
var level := 0
var tycoon = null
var t := 0.0
var yaw := 0.62
var pitch := 0.56
var dist := 52.0
var drag = null
var hover := -1
var sun_light: DirectionalLight3D

func _init() -> void:
	v = R3D.viewport(40.0)
	v.container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v.container)
	mouse_filter = Control.MOUSE_FILTER_STOP
	L = float(R3D.M.CITY.lot)
	world = Node3D.new()
	v.world.add_child(world)
	var pad = float(R3D.M.CITY.pad)
	for i in 9:
		var p = _lot_pos(i)
		var mi = R3D.box(Vector3(pad, 0.2, pad), R3D.pbr("pavers", Color.WHITE, 2.0, 0.0, Color("#b9b5ac")).duplicate(), Vector3(p.x, 0.1, p.y))
		v.world.add_child(mi)
		var holder = Node3D.new()
		holder.position = Vector3(p.x, 0.2, p.y)
		v.world.add_child(holder)
		lots.append({"pad": mi, "holder": holder, "key": "", "anims": [], "x": p.x, "z": p.y})

func _lot_pos(i: int) -> Vector2:
	return Vector2((1 - i / 3) * L, ((i % 3) - 1) * L)

func _set_level(lv: int) -> void:
	level = lv
	var th = R3D.M.CITY.levels[lv - 1]
	var night = th.lampsOn
	v.env.environment = R3D.environment(th.sky, th.exposure, Color(th.sun) * 0.3)
	if sun_light:
		sun_light.queue_free()
	sun_light = R3D.sun(Color(th.sun), float(th.sunI))
	v.world.add_child(sun_light)
	for c in world.get_children():
		c.queue_free()
	var ground = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size = Vector2(500, 500)
	ground.mesh = pm
	ground.material_override = R3D.pbr("grass", Color("#8fbf6a"), 4.0, 0.0, Color("#5f8a4a"))
	world.add_child(ground)
	# roads with lane markings
	var asphalt = R3D.pbr("asphalt", Color("#a8a8a8"), 4.0, 0.0, Color("#45464a"))
	var paint = R3D.flat(Color("#efe9d2"), 0.7)
	var road = float(R3D.M.CITY.road)
	var span = L * 3 + road
	for off in [-1.5 * L, -0.5 * L, 0.5 * L, 1.5 * L]:
		world.add_child(R3D.box(Vector3(span, 0.06, road), asphalt, Vector3(0, 0.03, off)))
		world.add_child(R3D.box(Vector3(road, 0.06, span), asphalt, Vector3(off, 0.03, 0)))
		var d = -span / 2 + 1
		while d < span / 2:
			world.add_child(R3D.box(Vector3(1.1, 0.01, 0.09), paint, Vector3(d, 0.065, off)))
			world.add_child(R3D.box(Vector3(0.09, 0.01, 1.1), paint, Vector3(off, 0.065, d)))
			d += 2.4
	# street furniture, cars, trees, lamps
	for d in R3D.M.CITY.props:
		var o = R3D.prop(d.model)
		if o == null:
			continue
		o.position = Vector3(d.p[0], d.p[1], d.p[2])
		o.rotation.y = d.ry
		if d.has("s"):
			o.scale *= float(d.s)
		world.add_child(o)
		if d.get("light", false) and night:
			var l = OmniLight3D.new()
			l.light_color = Color("#ffd49a"); l.light_energy = 3.0; l.omni_range = 20
			l.position = Vector3(d.p[0], 5.3, d.p[2])
			world.add_child(l)
	# skyline: photo-textured towers, windows lit at night
	var seed = 7
	for k in int(th.skyline):
		seed = (seed * 16807) % 2147483647; var a = seed / 2147483647.0 * TAU
		seed = (seed * 16807) % 2147483647; var r = 105 + seed / 2147483647.0 * 70
		seed = (seed * 16807) % 2147483647; var h = 14 + seed / 2147483647.0 * (8 + lv * 7)
		seed = (seed * 16807) % 2147483647; var w = 8 + seed / 2147483647.0 * 8
		var mat = R3D.pbr(R3D.M.CITY.skylineTex[k % 3], [Color("#c9c2b6"), Color("#d8d8d8"), Color("#b9bcc2")][k % 3], 8.0).duplicate()
		if night:
			mat.emission_enabled = true
			mat.emission = Color("#ffcf80")
			mat.emission_energy_multiplier = 0.35
		world.add_child(R3D.box(Vector3(w, h, w), mat, Vector3(cos(a) * r, h / 2, sin(a) * r)))
		world.add_child(R3D.box(Vector3(w + 0.4, 0.5, w + 0.4), R3D.flat(Color("#3d4148"), 0.7, 0.4), Vector3(cos(a) * r, h + 0.25, sin(a) * r)))
	R3D.shadows(world)
	for l in lots:
		l.key = ""

func _refresh_lot(i: int, tyc: Dictionary) -> void:
	var b = CC.BUILDINGS[i]
	var lot = lots[i]
	var n = CC.owned(tyc, b.id)
	var lv = CC.b_level(tyc, b.id)
	var unl = CC.unlocked(tyc, b)
	var ms = 0
	for m in [25, 50, 100, 200]:
		if n >= m: ms += 1
	var key = "%s|%s|%d|%d|%d" % [unl, n > 0, ms, min(lv, 6), level]
	if lot.key == key:
		return
	lot.key = key
	for c in lot.holder.get_children():
		c.queue_free()
	lot.anims = []
	var models = []
	if not unl:
		models.append([R3D.M.LOT.locked, Vector3.ZERO, 1.0])
	elif n == 0:
		models.append([R3D.M.LOT.forSale, Vector3.ZERO, 1.0])
	else:
		models.append([R3D.M.BUILDINGS[b.id], Vector3.ZERO, 1.0])
		# each milestone (25/50/100/200 owned) adds a smaller branch on the lot
		var corners = [Vector3(2.9, 0, 2.9), Vector3(2.9, 0, -2.9), Vector3(-2.9, 0, 2.9), Vector3(-2.9, 0, -2.9)]
		for k in ms:
			models.append([R3D.M.BUILDINGS[b.id], corners[k], 0.3])
	for m in models:
		var built = R3D.build(m[0])
		built.root.position = m[1]
		built.root.scale = Vector3.ONE * m[2]
		lot.holder.add_child(built.root)
		lot.anims.append_array(built.anims)
	# upgrade levels gild the lot
	var k = min(1.0, lv / 6.0)
	lot.pad.material_override.albedo_color = Color("#777777") if not unl else Color.WHITE.lerp(Color("#f0c95a"), k)
	lot.pad.material_override.metallic = k * 0.6

func update_city(tyc: Dictionary) -> void:
	tycoon = tyc
	if int(tyc.level) != level:
		_set_level(int(tyc.level))
	for i in 9:
		_refresh_lot(i, tyc)
	var on = CC.event_on(tyc, "crate")
	if on and crate == null:
		crate = R3D.build(R3D.M.LOT.crate)
		crate.root.position = Vector3(L * 1.5 + 3.5, 0.5, 0)
		v.world.add_child(crate.root)
	elif not on and crate != null:
		crate.root.queue_free()
		crate = null

func _process(dt: float) -> void:
	if not is_visible_in_tree():
		return
	t += dt
	if drag == null:
		yaw += dt * 0.025
	v.camera.position = Vector3(cos(yaw) * cos(pitch), sin(pitch), sin(yaw) * cos(pitch)) * dist
	v.camera.look_at(Vector3(0, 1.5, 0))
	for i in lots.size():
		R3D.animate(lots[i].anims, t)
		var pm = lots[i].pad.material_override
		pm.emission_enabled = i == hover
		pm.emission = Color("#3a5a8a")
	if crate:
		crate.root.rotation.y = t * 1.5
		crate.root.position.y = 0.6 + sin(t * 3) * 0.2
	# coins float up from earning buildings (faster with more income; green during a boom)
	if tycoon:
		var boom = CC.event_on(tycoon, "boom")
		for i in 9:
			var inc = CC.b_income(tycoon, CC.BUILDINGS[i])
			if inc > 0 and randf() < dt * min(4.0, 0.4 + log(inc + 1) / log(10) * 0.35) * (2.5 if boom else 1.0):
				var c = null
				for q in coins:
					if not q.visible:
						c = q
						break
				if c == null:
					c = MeshInstance3D.new()
					var cm = CylinderMesh.new(); cm.top_radius = 0.24; cm.bottom_radius = 0.24; cm.height = 0.05; cm.radial_segments = 24
					c.mesh = cm
					c.material_override = R3D.flat(Color("#f5c542"), 0.2, 1.0, Color.BLACK, 0.0, 0.99)
					c.rotation.x = PI / 2
					v.world.add_child(c)
					coins.append(c)
				c.visible = true
				c.set_meta("t", 0.0)
				c.material_override.albedo_color = Color("#4ade80") if boom else Color("#f5c542")
				c.position = Vector3(lots[i].x + (randf() - 0.5) * 3, 2.5 + randf() * 2, lots[i].z + (randf() - 0.5) * 3)
	for c in coins:
		if c.visible:
			var ct = c.get_meta("t") + dt
			c.set_meta("t", ct)
			c.position.y += dt * 1.6
			c.rotation.z += dt * 5
			c.material_override.albedo_color.a = 1 - ct / 1.6
			if ct > 1.6:
				c.visible = false

# Ground point under the mouse -> lot index, "crate", or -1.
func _pick(p: Vector2):
	var from = v.camera.project_ray_origin(p)
	var dir = v.camera.project_ray_normal(p)
	if crate:
		var cp = crate.root.position
		var along = (cp - from).dot(dir)
		if (from + dir * along).distance_to(cp) < 1.2:
			return "crate"
	if abs(dir.y) < 0.0001:
		return -1
	var hit = from + dir * ((0.2 - from.y) / dir.y)
	var half = float(R3D.M.CITY.pad) / 2
	for i in 9:
		if abs(hit.x - lots[i].x) < half and abs(hit.z - lots[i].z) < half:
			return i
	return -1

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed:
			dist = max(24.0, dist - 3.0)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed:
			dist = min(95.0, dist + 3.0)
		elif e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed:
				drag = {"pos": e.position, "yaw": yaw, "pitch": pitch, "moved": false}
			elif drag != null:
				if not drag.moved:
					var p = _pick(e.position)
					if typeof(p) == TYPE_STRING:
						crate_clicked.emit()
					elif p >= 0:
						lot_clicked.emit(p)
				drag = null
	elif e is InputEventMouseMotion:
		if drag != null:
			var d = e.position - drag.pos
			if abs(d.x) + abs(d.y) > 4:
				drag.moved = true
			yaw = drag.yaw + d.x * 0.006
			pitch = clamp(drag.pitch + d.y * 0.004, 0.22, 1.25)
		else:
			var p = _pick(e.position)
			hover = p if typeof(p) == TYPE_INT else -1
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if typeof(p) == TYPE_STRING or p >= 0 else Control.CURSOR_DRAG
