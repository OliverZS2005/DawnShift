# 3D tycoon city for the desktop app, walked in first person: 3x3 lots on a plaza in the middle of city
# blocks, with street furniture, traffic, a skyline in the haze and the golden crate. Every business you
# own runs a production line: machines feed boxes onto a conveyor that carries them to a till.
# Click to take the mouse, WASD to walk (Shift runs), look at a lot: E (or click) buys, R upgrades,
# Esc frees the mouse. Mirrors createCity() in ../render3d.js.
extends Control

signal lot_clicked(i: int)
signal upgrade_clicked(i: int)
signal crate_clicked

const EYE := 1.62
const SENS := 0.0022
const REACH := 9.0

var v: Dictionary
var L: float
var P: float
var LINE: Dictionary
var lots := []
var world: Node3D
var streets: Node3D = null
var coins := []
var crate = null
var level := 0
var tycoon = null
var t := 0.0
var claim_at := 0.0
var me := {"x": 0.0, "z": 0.0, "yaw": 0.0, "pitch": -0.08, "walk": 0.0}
var aim = -1
var own_mouse := false
var sun_light: DirectionalLight3D
var steel: StandardMaterial3D
var belt_mat: StandardMaterial3D
var dot: ColorRect
var prompt: PanelContainer
var prompt_lbl: Label
var hint: Label

func _init() -> void:
	v = R3D.viewport(70.0)
	v.camera.near = 0.05
	v.container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	v.container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(v.container)
	mouse_filter = Control.MOUSE_FILTER_STOP
	L = float(R3D.M.CITY.lot)
	P = float(R3D.M.CITY.pad)
	LINE = R3D.M.CITY.line
	me.z = 1.5 * L + 2.2
	world = Node3D.new()
	v.world.add_child(world)
	for i in 9:
		var p = _lot_pos(i)
		var mi = R3D.box(Vector3(P, 0.2, P), R3D.pbr("pavers", Color.WHITE, 2.0, 0.0, Color("#b9b5ac")).duplicate(), Vector3(p.x, 0.1, p.y))
		v.world.add_child(mi)
		var holder = Node3D.new()
		holder.position = Vector3(p.x, 0.2, p.y)
		v.world.add_child(holder)
		lots.append({"pad": mi, "holder": holder, "key": "", "anims": [], "x": p.x, "z": p.y, "top": 0.4, "line": null})
	steel = R3D.flat(Color("#3d4045"), 0.4, 0.75)
	belt_mat = StandardMaterial3D.new()
	belt_mat.albedo_texture = _belt_tex()
	belt_mat.roughness = 0.85
	belt_mat.uv1_scale = Vector3(float(LINE.length) / 0.6, 1, 1)
	_overlay()

func _lot_pos(i: int) -> Vector2:
	return Vector2((1 - i / 3) * L, ((i % 3) - 1) * L)

# dark rubber with raised ribs, tiled along the conveyor
func _belt_tex() -> ImageTexture:
	var img = Image.create(64, 64, false, Image.FORMAT_RGB8)
	img.fill(Color("#1b1c1e"))
	img.fill_rect(Rect2i(0, 0, 10, 64), Color("#2c2e31"))
	return ImageTexture.create_from_image(img)

# crosshair dot, the prompt for the lot you look at, and the controls hint
func _overlay() -> void:
	dot = ColorRect.new()
	dot.color = Color(0.95, 0.94, 0.91, 0.9)
	dot.size = Vector2(5, 5)
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dot)
	prompt = PanelContainer.new()
	var sb = StyleBoxFlat.new()
	sb.bg_color = Color(0.043, 0.051, 0.063, 0.78)
	sb.set_corner_radius_all(2)
	sb.content_margin_left = 12; sb.content_margin_right = 12; sb.content_margin_top = 6; sb.content_margin_bottom = 6
	prompt.add_theme_stylebox_override("panel", sb)
	prompt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	prompt_lbl = Label.new()
	prompt_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_lbl.add_theme_font_override("font", R3D.font("barlow-condensed-600"))
	prompt_lbl.add_theme_font_size_override("font_size", 16)
	prompt_lbl.add_theme_color_override("font_color", Color("#F2EFE8"))
	prompt.add_child(prompt_lbl)
	prompt.visible = false
	add_child(prompt)
	hint = Label.new()
	hint.text = "Click to walk around your business · WASD to move, Shift to run · look at a lot: E buys, R upgrades · Esc frees the mouse"
	hint.add_theme_font_size_override("font_size", 13)
	hint.add_theme_color_override("font_color", Color(0.95, 0.94, 0.91, 0.8))
	hint.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
	hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(hint)

func _layout_overlay() -> void:
	dot.position = size / 2 - dot.size / 2
	prompt.reset_size()
	prompt.position = Vector2((size.x - prompt.size.x) / 2, size.y / 2 + 22)
	hint.reset_size()
	hint.position = Vector2(12, size.y - hint.size.y - 8)
	hint.visible = not own_mouse

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
	# the business takes up a paved plaza in the middle of the city
	var clear = R3D.M.URBAN.city.clear
	var plaza = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size = Vector2(2 * clear[0], 2 * clear[1])
	plaza.mesh = pm
	plaza.material_override = R3D.pbr("pavers", Color("#a9a399"), 2.5, 0.0, Color("#77746f"))
	world.add_child(plaza)
	streets = R3D.city("city", night)
	world.add_child(streets)
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
	# street furniture, cars, lamps
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
	R3D.shadows(world)
	for l in lots:
		l.key = ""

# A production line along the lot's front edge: `machines` machines on steel tables feeding a conveyor
# that runs into a till. Boxes on the belt are pooled; _process() spawns and moves them.
func _production_line(i: int, machines: int) -> Dictionary:
	var g = Node3D.new()
	var length = float(LINE.length)
	var half = length / 2
	var y = float(LINE.height)
	var z = P / 2 - 0.55
	var table = func(w: float, d: float, x: float, pz: float) -> void: # steel top on four legs
		g.add_child(R3D.box(Vector3(w, 0.05, d), steel, Vector3(x, y - 0.075, pz)))
		for sx in [-1, 1]:
			for sz in [-1, 1]:
				g.add_child(R3D.box(Vector3(0.05, y - 0.1, 0.05), steel, Vector3(x + sx * (w / 2 - 0.05), (y - 0.1) / 2, pz + sz * (d / 2 - 0.05))))
	var belt = MeshInstance3D.new()
	var bm = PlaneMesh.new(); bm.size = Vector2(length, 0.62)
	belt.mesh = bm
	belt.material_override = belt_mat
	belt.position = Vector3(0, y + 0.026, z)
	g.add_child(belt)
	g.add_child(R3D.box(Vector3(length, 0.05, 0.62), steel, Vector3(0, y, z)))
	for s in [-1, 1]:
		g.add_child(R3D.box(Vector3(length + 0.1, 0.16, 0.06), steel, Vector3(0, y + 0.02, z + s * 0.34))) # side rails
	for k in 5:
		for s in [-1, 1]:
			g.add_child(R3D.box(Vector3(0.06, y, 0.06), steel, Vector3(-half + k * length / 4, y / 2, z + s * 0.3))) # legs
	var stands = []
	for k in machines:
		var mx = -half + 0.7 + k * 1.7
		table.call(1.1, 0.9, mx, z - 0.85)
		var o = R3D.prop(LINE.machines[(i + k) % LINE.machines.size()])
		if o:
			o.position = Vector3(mx, y - 0.05, z - 0.85)
			o.rotation.y = PI
			g.add_child(o)
		stands.append(mx)
	table.call(0.8, 0.8, half + 0.45, z) # the till's table
	var till = R3D.prop("cash_register")
	if till:
		till.position = Vector3(half + 0.45, y, z)
		till.rotation.y = -PI / 2
		g.add_child(till)
	R3D.shadows(g)
	return {"group": g, "stands": stands, "z": z, "items": [], "until": randf()}

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
	lot.line = null
	var models = []
	if not unl:
		models.append([R3D.M.LOT.locked, Vector3.ZERO, 1.0])
	elif n == 0:
		models.append([R3D.M.LOT.forSale, Vector3.ZERO, 1.0])
	else:
		models.append([R3D.M.BUILDINGS[b.id], Vector3(0, 0, -0.9), 0.85])
		# each milestone (25/50/100/200 owned) adds a smaller branch along the back of the lot
		var spots = [Vector3(-2.9, 0, -2.9), Vector3(2.9, 0, -2.9), Vector3(-2.9, 0, -0.6), Vector3(2.9, 0, -0.6)]
		for k in ms:
			models.append([R3D.M.BUILDINGS[b.id], spots[k], 0.3])
	var top = 0.4
	for m in models:
		var built = R3D.build(m[0])
		built.root.position = m[1]
		built.root.scale = Vector3.ONE * m[2]
		lot.holder.add_child(built.root)
		lot.anims.append_array(built.anims)
		var box = R3D.aabb(built.root)
		top = max(top, box.end.y * m[2])
	lot.top = top
	if unl and n > 0:
		lot.line = _production_line(i, min(3, 1 + ms))
		lot.holder.add_child(lot.line.group)
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
		crate.root.position = Vector3(0, 0.5, 1.5 * L + 0.6)
		v.world.add_child(crate.root)
	elif not on and crate != null:
		crate.root.queue_free()
		crate = null
	_prompt()

# For tests and screenshots.
func place(x: float, z: float, yaw: float, pitch: float) -> void:
	me.x = x; me.z = z; me.yaw = yaw; me.pitch = pitch

func release() -> void:
	if own_mouse and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	own_mouse = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_VISIBILITY_CHANGED and not is_visible_in_tree():
		release()

func _typing() -> bool:
	return get_viewport().gui_get_focus_owner() is LineEdit

# walking: inside the plaza, not through the lots
func _move(dt: float) -> float:
	if _typing():
		return 0.0
	var f = int(Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)) - int(Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN))
	var s = int(Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT)) - int(Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT))
	if f == 0 and s == 0:
		return 0.0
	var speed = 7.0 if Input.is_key_pressed(KEY_SHIFT) else 4.2
	var len = Vector2(f, s).length()
	var sn = sin(me.yaw)
	var cs = cos(me.yaw)
	me.x += (-sn * f + cs * s) / len * speed * dt
	me.z += (-cs * f - sn * s) / len * speed * dt
	var lim = float(R3D.M.URBAN.city.clear[0]) - 0.6
	me.x = clamp(me.x, -lim, lim)
	me.z = clamp(me.z, -lim, lim)
	for l in lots: # push out of a lot along the shallower side
		var h = P / 2 + 0.35
		var dx = me.x - l.x
		var dz = me.z - l.z
		if abs(dx) < h and abs(dz) < h:
			if h - abs(dx) < h - abs(dz):
				me.x = l.x + (1.0 if dx >= 0 else -1.0) * h
			else:
				me.z = l.z + (1.0 if dz >= 0 else -1.0) * h
	return speed

# what's under the crosshair (a lot index, "crate", or -1), within reach
func _aimed():
	var from = v.camera.global_position
	var dir = -v.camera.global_transform.basis.z
	var best = REACH
	var hit = -1
	if crate:
		var cp = crate.root.position
		var along = (cp - from).dot(dir)
		if along > 0 and along < best and (from + dir * along).distance_to(cp) < 0.8:
			best = along
			hit = "crate"
	for i in 9:
		var l = lots[i]
		var box = AABB(Vector3(l.x - P / 2, 0, l.z - P / 2), Vector3(P, 0.2 + l.top, P))
		var p = null if box.has_point(from) else box.intersects_ray(from, dir)
		if p != null and from.distance_to(p) < best:
			best = from.distance_to(p)
			hit = i
	return hit

func _prompt() -> void:
	if typeof(aim) == TYPE_STRING:
		prompt_lbl.text = "Golden crate · walk into it to claim"
	elif aim < 0 or tycoon == null:
		prompt.visible = false
		return
	else:
		var b = CC.BUILDINGS[aim]
		if not CC.unlocked(tycoon, b):
			prompt_lbl.text = "%s · reach %s to unlock" % [b.name, CC.LEVELS[b.unlock - 1]]
		else:
			var buy = CC.b_cost(tycoon, b)
			var up = CC.b_up_cost(tycoon, b)
			var n = CC.owned(tycoon, b.id)
			var txt = "%s ×%d\n[E] Buy %s%s" % [b.name, n, CC.fmt(buy), " (not enough)" if tycoon.money < buy else ""]
			if n > 0:
				txt += "    [R] Upgrade %s%s" % [CC.fmt(up), " (not enough)" if tycoon.money < up else ""]
			prompt_lbl.text = txt
	prompt.visible = true

func _process(dt: float) -> void:
	if not is_visible_in_tree():
		return
	dt = min(dt, 0.05)
	t += dt
	var speed = _move(dt)
	me.walk += speed * dt * 1.9
	var bob = 0.0 if speed == 0.0 else abs(cos(me.walk)) * 0.04
	v.camera.position = Vector3(me.x, EYE + bob, me.z)
	v.camera.rotation = Vector3(me.pitch, me.yaw, 0)
	if crate and t > claim_at and Vector2(me.x - crate.root.position.x, me.z - crate.root.position.z).length() < 1.6:
		claim_at = t + 1.0
		crate_clicked.emit() # walk into it to claim
	var a = _aimed()
	if typeof(a) != typeof(aim) or a != aim:
		aim = a
		_prompt()
	_layout_overlay()
	if streets:
		R3D.tick_city(streets, t)
	for i in lots.size():
		R3D.animate(lots[i].anims, t)
		var pm = lots[i].pad.material_override
		pm.emission_enabled = typeof(aim) == TYPE_INT and i == aim
		pm.emission = Color("#3a5a8a") * 0.5
	if crate:
		crate.root.rotation.y = t * 1.5
		crate.root.position.y = 0.6 + sin(t * 3) * 0.2
	# production lines: boxes come off the machines and ride the belt to the till (more income, more boxes)
	belt_mat.uv1_offset.x -= dt * float(LINE.speed) / 0.6 # one texture repeat = 0.6 m, between ribs
	var boom = tycoon != null and CC.event_on(tycoon, "boom")
	var half = float(LINE.length) / 2
	for i in 9:
		var line = lots[i].line
		if line == null:
			continue
		var inc = CC.b_income(tycoon, CC.BUILDINGS[i]) if tycoon else 0.0
		line.until -= dt * min(3.0, 0.35 + log(inc + 1) / log(10) * 0.3) * (2.0 if boom else 1.0)
		if line.until <= 0:
			line.until = 1.0
			var it = null
			for o in line.items:
				if not o.visible:
					it = o
					break
			if it == null:
				it = R3D.prop("box")
				if it == null:
					continue
				it.scale *= 0.55
				line.items.append(it)
				line.group.add_child(it)
			it.visible = true
			it.position = Vector3(line.stands[randi() % line.stands.size()], float(LINE.height) + 0.03, line.z)
			it.rotation.y = randf() * 0.4 - 0.2
		for it in line.items:
			if it.visible:
				it.position.x += float(LINE.speed) * dt
				if it.position.x > half + 0.1:
					it.visible = false
					_coin(Vector3(lots[i].x + half + 0.45, float(LINE.height) + 1.0, lots[i].z + line.z), boom)
	for c in coins:
		if c.visible:
			var ct = c.get_meta("t") + dt
			c.set_meta("t", ct)
			c.position.y += dt * 1.2
			c.rotation.z += dt * 6
			c.material_override.albedo_color.a = 1 - ct / 1.2
			if ct > 1.2:
				c.visible = false

func _coin(pos: Vector3, boom: bool) -> void:
	var c = null
	for q in coins:
		if not q.visible:
			c = q
			break
	if c == null:
		c = MeshInstance3D.new()
		var cm = CylinderMesh.new(); cm.top_radius = 0.12; cm.bottom_radius = 0.12; cm.height = 0.03; cm.radial_segments = 20
		c.mesh = cm
		c.material_override = R3D.flat(Color("#f5c542"), 0.2, 1.0, Color.BLACK, 0.0, 0.99)
		c.rotation.x = PI / 2
		v.world.add_child(c)
		coins.append(c)
	c.visible = true
	c.set_meta("t", 0.0)
	c.material_override.albedo_color = Color("#4ade80") if boom else Color("#f5c542")
	c.position = pos

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT and e.pressed:
		if not own_mouse:
			own_mouse = true
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		elif typeof(aim) == TYPE_INT and aim >= 0:
			lot_clicked.emit(aim)

func _input(e: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if own_mouse and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		own_mouse = false
	if e is InputEventMouseMotion and own_mouse:
		me.yaw -= e.relative.x * SENS
		me.pitch = clamp(me.pitch - e.relative.y * SENS, -1.3, 1.3)
	elif e is InputEventMouseButton and own_mouse and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		# the captured mouse sits wherever it was clicked; send clicks here even if it is over the cards
		if typeof(aim) == TYPE_INT and aim >= 0:
			lot_clicked.emit(aim)
		get_viewport().set_input_as_handled()
	elif e is InputEventKey and e.pressed and not e.echo and not _typing():
		if e.keycode == KEY_ESCAPE and own_mouse:
			release()
			get_viewport().set_input_as_handled()
		elif e.keycode == KEY_E and typeof(aim) == TYPE_INT and aim >= 0:
			lot_clicked.emit(aim)
		elif e.keycode == KEY_R and typeof(aim) == TYPE_INT and aim >= 0:
			upgrade_clicked.emit(aim)
