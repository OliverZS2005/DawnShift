# 3D tycoon city for the desktop app, walked in first person: 3x3 lots on a plaza in the middle of city
# blocks, with street furniture, traffic, a skyline in the haze and the golden crate. Every business you
# own is a building whose front door leads into a room much bigger than it (shown through the door like
# a portal): a factory hall or a shop, where production lines turn out boxes that ride to the till.
# Click to take the mouse, WASD to walk (Shift runs), look at a lot: E (or click) buys, R upgrades,
# Esc frees the mouse. Mirrors createCity() in ../render3d.js.
extends Control

signal lot_clicked(i: int)
signal upgrade_clicked(i: int)
signal crate_clicked

const EYE := 1.62
const SENS := 0.0022
const REACH := 9.0
# render layers: rooms (lit only by their own lights; the sun is masked off), each lot's building (so the
# view out of a room can leave it out) and the portal doors themselves (never seen by the portal camera)
const ROOM_LAYER := 2
const PORTAL_LAYER := 1 << 19
const ALL_LAYERS := 0xFFFFF
const PORTAL_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, fog_disabled, shadows_disabled;
uniform sampler2D portal : hint_default_black, filter_linear;
void fragment() { ALBEDO = texture(portal, SCREEN_UV).rgb; }
"""

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
# room: the business you're inside (-1: out in the plaza); floor: the ground under you (lots and rooms are 0.2 up)
var me := {"x": 0.0, "z": 0.0, "yaw": 0.0, "pitch": -0.08, "walk": 0.0, "room": -1, "floor": 0.0}
var rooms := {} # lot index -> the room built for it (only the one you're in or nearest to)
var want := -1
var pv: SubViewport # the portal: a second camera in the same world, drawn into a texture the door shows
var portal_cam: Camera3D
var portal_mat: ShaderMaterial
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
	me.x = L # in front of the arcade, the lemonade stand and coffee shop behind it
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
		lots.append({"pad": mi, "holder": holder, "key": "", "anims": [], "x": p.x, "z": p.y, "top": 0.4, "door": null, "portal": null, "kind": "empty", "ms": 0})
	steel = R3D.flat(Color("#3d4045"), 0.4, 0.75)
	belt_mat = StandardMaterial3D.new()
	belt_mat.albedo_texture = _belt_tex()
	belt_mat.roughness = 0.85
	belt_mat.uv1_scale = Vector3(float(LINE.length) / 0.6, 1, 1)
	_overlay()
	pv = SubViewport.new()
	pv.use_hdr_2d = true # linear colour, tone-mapped once by the main view
	pv.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(pv)
	portal_cam = Camera3D.new()
	pv.add_child(portal_cam)
	portal_mat = ShaderMaterial.new()
	portal_mat.shader = Shader.new()
	portal_mat.shader.code = PORTAL_SHADER
	portal_mat.set_shader_parameter("portal", pv.get_texture())

func _room_at(i: int) -> Vector3:
	return Vector3(2000 + i * 60, 0.2, 0)

# the offset from lot i's door to its room's doorway
func _room_offset(i: int) -> Vector3:
	var l = lots[i]
	return _room_at(i) - Vector3(l.x + float(l.door.x), 0.2, l.z + float(l.door.z))

func _layers(n: Node, mask: int) -> void:
	if n is VisualInstance3D:
		n.layers = mask
	for c in n.get_children():
		_layers(c, mask)

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
	hint.text = "Click to walk around your business · WASD to move, Shift to run · walk through a front door to go inside · look at a lot: E buys, R upgrades · Esc frees the mouse"
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
	sun_light.light_cull_mask = ALL_LAYERS & ~ROOM_LAYER # rooms have roofs
	v.world.add_child(sun_light)
	# the portal camera sees the same world in linear colour (the main view tone-maps and grades the door)
	var pe: Environment = v.env.environment.duplicate()
	pe.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	pe.tonemap_exposure = 1.0
	pe.glow_enabled = false
	pe.adjustment_enabled = false
	portal_cam.environment = pe
	for r in rooms.values():
		r.group.queue_free()
	rooms.clear()
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
			l.light_color = Color("#ffd49a"); l.light_energy = 1.2; l.omni_range = 20
			l.position = Vector3(d.p[0], 5.3, d.p[2])
			world.add_child(l)
	R3D.shadows(world)
	for l in lots:
		l.key = ""

# A production line: `machines` machines on steel tables feeding a conveyor (along x, at z) that runs into
# a till. Boxes on the belt are pooled; _process() spawns and moves them.
func _production_line(i: int, machines: int, z := 0.0) -> Dictionary:
	var g = Node3D.new()
	var length = float(LINE.length)
	var half = length / 2
	var y = float(LINE.height)
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

# The inside of business i (lot i) at `ms` milestones (INTERIORS in models.json, from interior() in
# ../models.js), at _room_at(i). Mirrors buildRoom() in ../render3d.js.
func _build_room(i: int, ms: int) -> Dictionary:
	var R = R3D.M.INTERIORS[CC.BUILDINGS[i].id][ms]
	var g = Node3D.new()
	g.position = _room_at(i)
	v.world.add_child(g)
	for part in R.parts:
		var sz = Vector3(part[0][0], part[0][1], part[0][2])
		var c = Vector3(part[1][0], part[1][1], part[1][2])
		var tint = Color(part[3])
		g.add_child(R3D.box(sz, R3D.pbr(part[2], tint, 2.5, 0.0, tint) if part[2] != null else R3D.flat(tint, 0.6, 0.0), c))
	for d in R.props:
		var o = R3D.prop(d.model)
		if o:
			o.position = Vector3(d.p[0], d.p[1], d.p[2])
			o.rotation.y = float(d.ry)
			g.add_child(o)
	var lines = []
	for ln in R.lines:
		var line = _production_line(i, int(ln.machines))
		line.group.position = Vector3(float(ln.x), 0, float(ln.z))
		g.add_child(line.group)
		line.till = g.position + Vector3(float(ln.x) + float(LINE.length) / 2 + 0.45, float(LINE.height) + 1.0, float(ln.z))
		lines.append(line)
	var fac = R.kind == "factory"
	for p in R.lights:
		var l = OmniLight3D.new()
		l.light_color = Color("#f2f4ff") if fac else Color("#ffe6c4")
		l.light_energy = 3.6 if fac else 1.9
		l.omni_range = 20.0
		l.light_cull_mask = ROOM_LAYER
		l.position = Vector3(p[0], p[1], p[2])
		g.add_child(l)
	# no sky inside: the room's own ambient light and reflections
	var probe = ReflectionProbe.new()
	probe.size = Vector3(float(R.w) + 1, float(R.h) + 1, float(R.d) + 1)
	probe.position = Vector3(0, float(R.h) / 2, -float(R.d) / 2)
	probe.interior = true
	probe.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	probe.ambient_color = Color("#5a5048") if not fac else Color("#4f5256")
	probe.ambient_color_energy = 1.0
	probe.cull_mask = ROOM_LAYER
	g.add_child(probe)
	_layers(g, ROOM_LAYER)
	# the doorway from inside shows the plaza
	var exit = MeshInstance3D.new()
	var qm = QuadMesh.new(); qm.size = Vector2(R.door.w, R.door.h)
	exit.mesh = qm
	exit.material_override = portal_mat
	exit.position = Vector3(0, float(R.door.h) / 2, -0.01)
	exit.layers = PORTAL_LAYER
	g.add_child(exit)
	return {"i": i, "ms": ms, "group": g, "R": R, "lines": lines, "exit": exit}

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
	lot.door = null
	lot.portal = null
	lot.ms = ms
	lot.kind = "locked" if not unl else ("shop" if n > 0 else "empty")
	if rooms.has(i):
		rooms[i].group.queue_free()
		rooms.erase(i)
	var night = R3D.M.CITY.levels[level - 1].lampsOn
	var top = 0.4
	if not unl or n == 0:
		var kind = "locked" if not unl else "forSale"
		var built = R3D.build(R3D.M.LOT[kind])
		lot.holder.add_child(built.root)
		var bd = R3D.M.LOT.boards[kind]
		lot.holder.add_child(R3D.sign_board(bd.text, bd.colors, 1.6, 0.85, Vector3(bd.at[0], bd.at[1], bd.at[2]), 0.0))
		if not unl:
			lot.holder.add_child(R3D.fence())
		top = 2.5
	else:
		# a real building from the facade kits, a floor taller for each milestone (25/50/100/200 owned)
		var spec = R3D.M.SHOP_BUILDINGS[b.id][ms]
		var house = R3D.shop_building(b, ms, night)
		_layers(house, 1 << (3 + i)) # its own layer: the view out of its room leaves it out
		lot.holder.add_child(house)
		top = float(spec.h) + 0.8
		# its front door: a portal into the inside (drawn by _process())
		lot.door = spec.door
		var q = MeshInstance3D.new()
		var qm = QuadMesh.new(); qm.size = Vector2(spec.door.w, spec.door.h)
		q.mesh = qm
		q.material_override = portal_mat
		q.position = Vector3(float(spec.door.x), float(spec.door.h) / 2, float(spec.door.z) + 0.012)
		q.layers = PORTAL_LAYER
		q.visible = false
		lot.holder.add_child(q)
		lot.portal = q
	lot.top = top
	# upgrade levels warm the paving towards sandstone
	var k = min(1.0, lv / 6.0)
	lot.pad.material_override.albedo_color = Color("#8a8a8a") if not unl else Color.WHITE.lerp(Color("#e3c98f"), k * 0.6)

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

# For tests and screenshots: x, z in the plaza, or in room `room`'s own coordinates.
func place(x: float, z: float, yaw: float, pitch: float, room := -1) -> void:
	if room >= 0:
		x += _room_at(room).x
		z += _room_at(room).z
		me.floor = 0.2
	me.x = x; me.z = z; me.yaw = yaw; me.pitch = pitch; me.room = room

func release() -> void:
	if own_mouse and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	own_mouse = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_VISIBILITY_CHANGED and not is_visible_in_tree():
		release()

func _typing() -> bool:
	return get_viewport().gui_get_focus_owner() is LineEdit

# out of a box (x0, z0)-(x1, z1) grown by rad, along the shallower side
func _push(x0: float, z0: float, x1: float, z1: float, rad: float) -> void:
	var a = me.x - (x0 - rad)
	var b = x1 + rad - me.x
	var c = me.z - (z0 - rad)
	var d = z1 + rad - me.z
	if a <= 0 or b <= 0 or c <= 0 or d <= 0:
		return
	var m = min(min(a, b), min(c, d))
	if m == a: me.x = x0 - rad
	elif m == b: me.x = x1 + rad
	elif m == c: me.z = z0 - rad
	else: me.z = z1 + rad

# walking: round the plaza (not through the buildings and fences) or round a room; through a front door
# into its room and back out. Mirrors move() in ../render3d.js.
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
	var pz = me.z
	me.x += (-sn * f + cs * s) / len * speed * dt
	me.z += (-cs * f - sn * s) / len * speed * dt
	if me.room >= 0: # inside: walls, the counter and the lines; out through the doorway
		var r = rooms[me.room]
		var R = r.R
		var o = r.group.position
		var lx = me.x - o.x
		var lz = me.z - o.z
		var in_door = abs(lx) < float(R.door.w) / 2 - 0.15
		if pz - o.z < 0 and lz >= 0 and in_door:
			var off = _room_offset(me.room)
			me.x -= off.x
			me.z -= off.z
			me.room = -1
			return speed
		me.x = o.x + clamp(lx, -float(R.w) / 2 + 0.35, float(R.w) / 2 - 0.35)
		me.z = o.z + clamp(lz, -float(R.d) + 0.35, 0.2 if in_door else -0.35)
		for bl in R.blocks:
			_push(o.x + bl[0], o.z + bl[1], o.x + bl[2], o.z + bl[3], 0.3)
		return speed
	var lim = float(R3D.M.URBAN.city.clear[0]) - 0.6
	me.x = clamp(me.x, -lim, lim)
	me.z = clamp(me.z, -lim, lim)
	for i in lots.size():
		var l = lots[i]
		if l.door != null and rooms.has(i): # through the front door?
			var dz = l.z + float(l.door.z)
			var dx = l.x + float(l.door.x)
			if pz > dz and me.z <= dz and abs(me.x - dx) < float(l.door.w) / 2 - 0.15:
				var off = _room_offset(i)
				me.x += off.x
				me.z += off.z
				me.room = i
				return speed
		if l.kind == "locked": # fenced off
			_push(l.x - P / 2, l.z - P / 2, l.x + P / 2, l.z + P / 2, 0.35)
		elif l.kind == "shop" and not (l.door != null and abs(me.x - l.x - float(l.door.x)) < float(l.door.w) / 2 - 0.15 and me.z > l.z + float(l.door.z)):
			_push(l.x - 3.05, l.z - 3.85, l.x + 3.05, l.z + 1.25, 0.3) # the building (but you can step into its doorway)
	return speed

# what's under the crosshair (a lot index, "crate", or -1), within reach
func _aimed():
	if me.room >= 0:
		return me.room # inside a business: E and R act on it
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
	# the room to have ready: the one you're in, else the nearest business whose door is within 25 m
	want = me.room
	if want < 0:
		var best = 25.0
		for i in lots.size():
			var l = lots[i]
			if l.door == null:
				continue
			var dd = Vector2(me.x - l.x - float(l.door.x), me.z - l.z - float(l.door.z)).length()
			if dd < best:
				best = dd
				want = i
	for i in rooms.keys():
		if i != want:
			rooms[i].group.queue_free()
			rooms.erase(i)
	if want >= 0 and not rooms.has(want):
		rooms[want] = _build_room(want, lots[want].ms)
	var speed = _move(dt)
	me.walk += speed * dt * 1.9
	var bob = 0.0 if speed == 0.0 else abs(cos(me.walk)) * 0.04
	var on_pad = me.room >= 0
	for l in lots:
		if abs(me.x - l.x) < P / 2 and abs(me.z - l.z) < P / 2:
			on_pad = true
	me.floor += ((0.2 if on_pad else 0.0) - me.floor) * min(1.0, dt * 12) # step up onto the paving
	v.camera.position = Vector3(me.x, me.floor + EYE + bob, me.z)
	v.camera.rotation = Vector3(me.pitch, me.yaw, 0)
	v.camera.cull_mask = ALL_LAYERS
	# the portal: from outside, the room seen through its door; from inside, the plaza through the doorway
	var room = rooms.get(want)
	var inside = me.room >= 0
	if room != null and (inside or lots[want].portal != null):
		if pv.world_3d == null:
			pv.world_3d = v.viewport.find_world_3d()
		pv.size = Vector2i(max(1, v.viewport.size.x / 2), max(1, v.viewport.size.y / 2))
		pv.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		var off = _room_offset(want)
		portal_cam.fov = v.camera.fov
		portal_cam.near = v.camera.near
		portal_cam.far = v.camera.far
		portal_cam.global_transform = Transform3D(v.camera.global_transform.basis, v.camera.global_transform.origin + off * (-1.0 if inside else 1.0))
		portal_cam.cull_mask = ALL_LAYERS & ~PORTAL_LAYER & (~(1 << (3 + want)) if inside else ALL_LAYERS)
	else:
		pv.render_target_update_mode = SubViewport.UPDATE_DISABLED
	# only the nearest door stands open (the portal shows its room); the others show their doors
	for i in lots.size():
		if lots[i].portal:
			lots[i].portal.visible = not inside and i == want
	for r in rooms.values():
		r.exit.visible = me.room == r.i
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
	for r in rooms.values():
		for line in r.lines:
			var inc = CC.b_income(tycoon, CC.BUILDINGS[r.i]) if tycoon else 0.0
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
					_layers(it, ROOM_LAYER)
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
						_coin(line.till, boom)
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
	c.layers = ROOM_LAYER # (coins only pop from the tills, inside)
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
