# Shared 3D helpers for the desktop app (autoload "R3D"): loads the CC0 art in res://assets, builds the
# procedural models described in models.json (generated from ../models.js), photo-textured materials,
# skies and environments. city3d.gd and arena3d.gd use these; render3d.js is the web equivalent.
extends Node

const TEAM = [Color("#2f6fd6"), Color("#d23b2e")] # you are always blue, your opponent red

var M: Dictionary = {}
var _scenes := {}
var _mats := {}

func _ready() -> void:
	var f = FileAccess.open("res://models.json", FileAccess.READ)
	M = JSON.parse_string(f.get_as_text())

# ---------- Assets ----------
func asset(rel: String) -> String:
	return "res://assets/" + rel

func scene(rel: String) -> PackedScene:
	if not _scenes.has(rel):
		_scenes[rel] = load(asset(rel)) if ResourceLoader.exists(asset(rel)) else null
	return _scenes[rel]

# Instances a downloaded model. Poly Haven models are real size; others are scaled to ASSETS.heights.
func prop(name: String) -> Node3D:
	var ps = scene(M.ASSETS.models.get(name, ""))
	if ps == null:
		return null
	var o: Node3D = ps.instantiate()
	if M.ASSETS.heights.has(name):
		var box = aabb(o)
		if box.size.y > 0.001:
			o.scale = Vector3.ONE * (float(M.ASSETS.heights[name]) / box.size.y)
	shadows(o)
	return o

# HUD typefaces bundled in assets/fonts (Barlow Condensed for labels, JetBrains Mono for numbers).
var _fonts := {}
func font(name: String) -> Font:
	if not _fonts.has(name):
		var p = asset("fonts/%s.woff2" % name)
		_fonts[name] = load(p) if ResourceLoader.exists(p) else ThemeDB.fallback_font
	return _fonts[name]

func shadows(n: Node) -> void:
	if n is GeometryInstance3D and not n.has_meta("no_shadow"):
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for c in n.get_children():
		shadows(c)

# Bounding box of every mesh under `root`, in root's space.
func aabb(root: Node3D) -> AABB:
	var out := AABB()
	var first := true
	var stack = [[root, Transform3D.IDENTITY]]
	while stack.size():
		var it = stack.pop_back()
		var n = it[0]
		var xf: Transform3D = it[1]
		if n is MeshInstance3D and n.mesh:
			var b = xf * n.mesh.get_aabb()
			out = b if first else out.merge(b)
			first = false
		for c in n.get_children():
			if c is Node3D:
				stack.append([c, xf * c.transform])
	return out

# Photo-textured material, mapped in world space so a texture keeps its real-world size on any shape.
func pbr(name: String, tint := Color.WHITE, tile := 2.5, metal := 0.0, fallback := Color("#888888")) -> StandardMaterial3D:
	var key = "%s|%s|%s|%s" % [name, tint.to_html(), tile, metal]
	if _mats.has(key):
		return _mats[key]
	var m = StandardMaterial3D.new()
	var diff = asset("textures/%s_diff.jpg" % name)
	if ResourceLoader.exists(diff):
		m.albedo_texture = load(diff)
		m.albedo_color = tint
		m.normal_enabled = true
		m.normal_texture = load(asset("textures/%s_nor.jpg" % name))
		m.roughness_texture = load(asset("textures/%s_rough.jpg" % name))
		m.roughness = 1.0
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3.ONE / tile
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	else:
		m.albedo_color = fallback
		m.roughness = 0.8
	m.metallic = metal
	_mats[key] = m
	return m

func flat(color: Color, rough := 0.6, metal := 0.05, emission := Color.BLACK, energy := 0.0, alpha := 1.0) -> StandardMaterial3D:
	var m = StandardMaterial3D.new()
	m.albedo_color = Color(color, alpha)
	m.roughness = rough
	m.metallic = metal
	if energy > 0:
		m.emission_enabled = true
		m.emission = emission
		m.emission_energy_multiplier = energy
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m

# ---------- Sky + environment ----------
# HDRI sky lighting, filmic tone mapping, ambient occlusion, glow and distance fog.
func environment(sky_name: String, exposure: float, _unused := Color.BLACK) -> Environment:
	var e = Environment.new()
	var tex_path = asset(M.ASSETS.skies[sky_name])
	if ResourceLoader.exists(tex_path):
		var mat = PanoramaSkyMaterial.new()
		mat.panorama = load(tex_path)
		var sky = Sky.new()
		sky.sky_material = mat
		e.background_mode = Environment.BG_SKY
		e.sky = sky
		e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		e.background_mode = Environment.BG_COLOR
		e.background_color = {"day": Color("#9fc3e6"), "sunset": Color("#e7a978"), "dusk": Color("#6b5a7e"), "night": Color("#141a30")}[sky_name]
		e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		e.ambient_light_color = e.background_color
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_exposure = exposure
	e.ssao_enabled = true
	e.ssao_radius = 1.2
	e.ssao_intensity = 1.6
	# GTA IV-style bloom: bright sky and highlights bleed a soft glow
	e.glow_enabled = true
	e.glow_intensity = 0.8
	e.glow_bloom = 0.12
	e.glow_hdr_threshold = 1.0
	# city smog: distant blocks fade into the haze. Depth fog (rather than exponential) matches the web's
	# curve and works the same in the OpenGL fallback.
	var haze = Color(M.URBAN.haze[sky_name])
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_light_color = haze
	e.fog_density = 1.0
	e.fog_depth_begin = 15.0
	e.fog_depth_end = 330.0
	e.fog_depth_curve = 1.7
	e.fog_sky_affect = 0.0
	# Colour grade in the spirit of GTA IV (same idea as GRADE in render3d.js): washed-out colour, more
	# contrast, and a per-channel tone curve that warms the shadows to sepia and the highlights to cream.
	e.adjustment_enabled = true
	e.adjustment_saturation = 0.76
	e.adjustment_contrast = 1.1
	var curve = Gradient.new()
	curve.set_color(0, Color(0.035, 0.026, 0.018))
	curve.set_color(1, Color(1.0, 0.975, 0.88))
	curve.add_point(0.5, Color(0.53, 0.5, 0.455))
	var lut = GradientTexture1D.new()
	lut.gradient = curve
	e.adjustment_color_correction = lut
	# Vulkan (Forward+) only; the OpenGL fallback ignores these. (No SDFGI: outdoors it darkened the
	# shade more than it added bounce light, and it's the costliest effect on weaker graphics cards.)
	# Bounce light and contact shading from what's on screen, and reflections on smooth floors.
	e.ssil_enabled = true
	e.ssil_radius = 4.0
	e.ssil_intensity = 0.8
	e.ssr_enabled = true
	e.ssr_max_steps = 48
	e.ssr_fade_out = 1.5
	# Thin volumetric haze: the air catches the sunlight (soft light shafts between the buildings).
	e.volumetric_fog_enabled = true
	e.volumetric_fog_density = 0.005
	e.volumetric_fog_albedo = haze
	e.volumetric_fog_anisotropy = 0.55
	e.volumetric_fog_length = 90.0
	e.volumetric_fog_sky_affect = 0.0
	return e

func sun(color: Color, energy: float) -> DirectionalLight3D:
	var d = DirectionalLight3D.new()
	d.light_color = color
	# models.json gives three.js intensities; Godot's diffuse is pi times brighter for the same number
	d.light_energy = energy / PI
	d.shadow_enabled = true
	d.shadow_blur = 1.5
	d.directional_shadow_max_distance = 80.0
	d.rotation = Vector3(deg_to_rad(-52), deg_to_rad(40), 0)
	return d

# ---------- Procedural models from models.json ----------
func _mesh_for(p: Dictionary) -> Mesh:
	var s = p.s
	var seg = int(p.get("seg", 24))
	match p.t:
		"box":
			var b = BoxMesh.new(); b.size = Vector3(s[0], s[1], s[2]); return b
		"cyl":
			var c = CylinderMesh.new(); c.top_radius = s[0]; c.bottom_radius = s[1]; c.height = s[2]; c.radial_segments = seg; return c
		"sph":
			var sp = SphereMesh.new(); sp.radius = s[0]; sp.height = s[0] * 2; sp.radial_segments = seg; sp.rings = max(8, seg / 2); return sp
		"cone":
			var cn = CylinderMesh.new(); cn.top_radius = 0.0; cn.bottom_radius = s[0]; cn.height = s[1]; cn.radial_segments = seg; return cn
		_:
			var t = TorusMesh.new(); t.inner_radius = s[0] - s[1]; t.outer_radius = s[0] + s[1]; t.rings = 64; t.ring_segments = 16; return t

func _material_for(p: Dictionary, team: Color) -> StandardMaterial3D:
	if p.has("tx"):
		return pbr(p.tx, Color(p.get("tc", "#ffffff")), 2.5, float(p.get("m", 0.0)))
	var color = team if p.c == "team" else Color(p.c)
	var ei = float(p.get("ei", 1.0 if p.has("e") else 0.0))
	return flat(color, float(p.get("ro", 0.6)), float(p.get("m", 0.05)), Color(p.get("e", "#000000")), ei * (2.0 if ei > 1.2 else 1.0), float(p.get("o", 1.0)))

# Returns {root, groups, anims} like build() in render3d.js.
func build(model, team := TEAM[0]) -> Dictionary:
	var root = Node3D.new()
	var groups = {}
	var anims = []
	var parts = model.parts if typeof(model) == TYPE_DICTIONARY else model
	if typeof(model) == TYPE_DICTIONARY and model.has("groups"):
		for name in model.groups:
			var g = Node3D.new()
			g.position = _v(model.groups[name].p)
			root.add_child(g)
			groups[name] = g
			if model.groups[name].has("a"):
				anims.append({"obj": g, "a": model.groups[name].a, "rot": g.rotation, "phase": randf() * 6})
	for p in parts:
		var mi = MeshInstance3D.new()
		mi.mesh = _mesh_for(p)
		var mat = _material_for(p, team)
		if p.has("a") or p.c == "team":
			mat = mat.duplicate()
		mi.material_override = mat
		mi.rotation_order = EULER_ORDER_XYZ # models.js uses Three.js's XYZ rotation order
		mi.position = _v(p.p)
		if p.has("r"):
			mi.rotation = _v(p.r)
		if p.t == "torus": # Three's torus lies in XY, Godot's in XZ
			mi.rotation += Vector3(PI / 2, 0, 0)
		if p.has("sc"):
			mi.scale = _v(p.sc)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if float(p.get("o", 1.0)) < 1.0 else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		(groups[p.g] if p.has("g") else root).add_child(mi)
		if p.has("a"):
			anims.append({"obj": mi, "a": p.a, "base": mi.position, "rot": mi.rotation, "ei": mat.emission_energy_multiplier, "op": mat.albedo_color.a, "phase": randf() * 6})
	return {"root": root, "groups": groups, "anims": anims}

func animate(anims: Array, t: float) -> void:
	for k in anims:
		var o = k.obj
		var tt = t + k.phase
		match k.a:
			"spin": o.rotation.z = k.rot.z + t * 0.8
			"spinY": o.rotation.y = k.rot.y + t * 0.6
			"pump": o.rotation.z = sin(t * 2.2) * 0.32
			"bob": o.position.y = k.base.y + sin(tt * 2) * 0.15
			"blink": o.material_override.emission_energy_multiplier = k.ei if fmod(tt, 1.2) < 0.6 else 0.05
			"pulse": o.material_override.emission_energy_multiplier = k.ei * (0.75 + 0.25 * sin(tt * 3))
			"smoke":
				var f = fmod(t * 0.35 + k.phase / 6.0, 1.0)
				o.position = Vector3(k.base.x - f * 0.8, k.base.y + f * 2.4, k.base.z)
				o.scale = Vector3.ONE * (0.7 + f * 1.4)
				o.material_override.albedo_color.a = k.op * (1 - f)

func _v(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])

func box(size: Vector3, mat: Material, pos: Vector3) -> MeshInstance3D:
	var mi = MeshInstance3D.new()
	var b = BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = mat
	mi.position = pos
	return mi

# A view: SubViewportContainer holding its own 3D world, camera, sun and environment.
func viewport(fov: float) -> Dictionary:
	var c = SubViewportContainer.new()
	c.stretch = true
	var vp = SubViewport.new()
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	vp.positional_shadow_atlas_size = 2048
	c.add_child(vp)
	var world = Node3D.new()
	vp.add_child(world)
	var cam = Camera3D.new()
	cam.fov = fov
	cam.far = 500
	world.add_child(cam)
	var we = WorldEnvironment.new()
	world.add_child(we)
	return {"container": c, "viewport": vp, "world": world, "camera": cam, "env": we}

# ---------- City blocks: GTA-style streets around the arena or the business ----------
# The layout comes from models.json (LAYOUT, written from cityLayout() in ../models.js), so the web and
# desktop versions build the same streets. windows_of() is a port of windowsOf() (tests/parity checks it).
var _rng_state := 1
func _rng() -> float:
	_rng_state = (_rng_state * 16807) % 2147483647
	return _rng_state / 2147483647.0

# Windows on the sides of a building you can see from the middle: [x, y, z, rotationY, width, height, lit].
func windows_of(b: Dictionary, night: bool) -> Array:
	var U = M.URBAN
	_rng_state = int(b.seed)
	var out = []
	var sides = [[0, -1, float(b.w), 0.0], [0, 1, float(b.w), PI], [-1, 0, float(b.d), -PI / 2], [1, 0, float(b.d), PI / 2]]
	for sd in sides:
		var sx = sd[0]
		var sz = sd[1]
		if sx * -float(b.x) + sz * -float(b.z) < -1: # faces away from the middle
			continue
		var length = sd[2]
		var n = maxi(1, int(floor((length - 1.4) / 3.1)))
		var step = length / n
		for f in int(b.floors):
			var shop = f == 0
			var y = 1.55 if shop else f * float(U.storey) + 1.75
			var ww = min(step - 0.8, 2.6) if shop else 1.25
			var wh = 2.1 if shop else 1.65
			for k in n:
				var t = -length / 2 + step * (k + 0.5)
				var x = float(b.x) + (sx * (float(b.w) / 2 + 0.03) if sx else t)
				var z = float(b.z) + (sz * (float(b.d) / 2 + 0.03) if sz else t)
				out.append([snappedf(x, 0.01), snappedf(y, 0.01), snappedf(z, 0.01), sd[3], snappedf(ww, 0.01), wh, 1 if night and _rng() < 0.38 else 0])
	return out

# Adds a box to a SurfaceTool batch: UVs in metres / tu across and / tv up (textures keep their real
# size, and a painted window grid lines up with the floors); `color` tints a shared material.
const _FACES = [[Vector3.RIGHT, Vector3.UP], [Vector3.LEFT, Vector3.UP], [Vector3.BACK, Vector3.UP], [Vector3.FORWARD, Vector3.UP], [Vector3.UP, Vector3.FORWARD], [Vector3.DOWN, Vector3.BACK]]
func _box_into(st: SurfaceTool, size: Vector3, c: Vector3, tu: float, tv: float, color := Color.WHITE) -> void:
	var h = size / 2
	for f in _FACES:
		var n: Vector3 = f[0]
		var v: Vector3 = f[1]
		var u = v.cross(n) # to the right, seen from outside
		var hn = abs(n.dot(h))
		var hu = abs(u.dot(h))
		var hv = abs(v.dot(h))
		var su = (tv if n.y == 0 else tu)
		var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
		var pts = []
		for k in corners:
			pts.append([c + n * hn + u * hu * k[0] + v * hv * k[1], Vector2((k[0] + 1) * hu / tu, -(k[1] + 1) * hv / su)])
		for i in [0, 2, 1, 0, 3, 2]: # clockwise from outside: Godot's front faces
			st.set_color(color)
			st.set_normal(n)
			st.set_uv(pts[i][1])
			st.add_vertex(pts[i][0])

# Painted facade for distant buildings: 4 windows by 4 floors per tile (12.4 m x 13.2 m), and a matching
# glow map of lit windows for night.
var _grids := {}
func _window_grid(kind: String) -> ImageTexture:
	if _grids.has(kind):
		return _grids[kind]
	var img = Image.create(256, 256, false, Image.FORMAT_RGBA8)
	img.fill(Color("#d9d6d0") if kind == "map" else Color.BLACK)
	_rng_state = 11 if kind == "map" else 23
	if kind == "map":
		for i in 900: # grime
			var g = Color("#d9d6d0").darkened(_rng() * 0.08)
			img.fill_rect(Rect2i(int(_rng() * 256), int(_rng() * 256), 2 + int(_rng() * 6), 2 + int(_rng() * 10)), g)
	for fy in 4:
		for fx in 4:
			var r = Rect2i(fx * 64 + 17, fy * 64 + 14, 30, 36)
			if kind == "map":
				var g = (34 + int(_rng() * 18)) / 255.0
				img.fill_rect(r, Color(g, g + 0.024, g + 0.047))
				img.fill_rect(Rect2i(r.position, Vector2i(30, 10)), Color(g + 0.08, g + 0.1, g + 0.13))
			elif _rng() < 0.36:
				img.fill_rect(r, Color("#ffcf86") if _rng() < 0.7 else Color("#cfe3ff"))
	img.generate_mipmaps()
	_grids[kind] = ImageTexture.create_from_image(img)
	return _grids[kind]

func _batch(batches: Dictionary, key: String, mat: Material) -> SurfaceTool:
	if not batches.has(key):
		var st = SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		batches[key] = {"st": st, "mat": mat}
	return batches[key].st

# The streets, sidewalks, buildings (real windows up close, painted ones further out), rooftop water
# tanks, the skyline in the haze, and street furniture.
func city(where: String, night: bool) -> Node3D:
	var group = Node3D.new()
	var L = M.LAYOUT[where]
	var batches = {}
	var ground = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size = Vector2(1000, 1000)
	ground.mesh = pm
	ground.position.y = -0.04
	ground.material_override = pbr("asphalt", Color("#8d8c88"), 7.0, 0.0, Color("#3d3e40"))
	group.add_child(ground)
	var pav = pbr("pavers", Color("#b7b1a7"), 2.5, 0.0, Color("#77746f"))
	for s in L.sidewalks:
		_box_into(_batch(batches, "pav", pav), Vector3(s[2] - s[0], 0.15, s[3] - s[1]), Vector3((s[0] + s[2]) / 2, 0.075, (s[1] + s[3]) / 2), 2.5, 2.5)
	var far = StandardMaterial3D.new()
	far.albedo_texture = _window_grid("map")
	far.vertex_color_use_as_albedo = true
	far.vertex_color_is_srgb = true
	far.roughness = 0.85
	far.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if night:
		far.emission_enabled = true
		far.emission = Color.WHITE
		far.emission_texture = _window_grid("glow")
		far.emission_energy_multiplier = 1.1
	var trim = pbr("concrete_wall", Color("#a9a49b"), 2.5, 0.0, Color("#8a857d"))
	var tank_mat = flat(Color("#5e4a3a"), 0.9, 0.0)
	var shops = [pbr("shutter", Color("#8d8f8c"), 2.5, 0.0, Color("#4a4c4b")), pbr("plaster", Color("#5a514a"), 2.5, 0.0, Color("#4a443e"))]
	var windows = []
	for b in L.buildings:
		var w = float(b.w)
		var d = float(b.d)
		var h = float(b.h)
		var c = Vector3(float(b.x), 0, float(b.z))
		if not b.near:
			_box_into(_batch(batches, "far", far), Vector3(w, h, d), c + Vector3(0, h / 2, 0), 12.4, 13.2, Color(b.tint))
			continue
		var k = "+" if b.shade else "" # buildings near the middle cast shadows; batched separately
		_box_into(_batch(batches, b.tex + b.tint + k, pbr(b.tex, Color(b.tint), 2.5, 0.0, Color(b.tint))), Vector3(w, h, d), c + Vector3(0, h / 2, 0), 2.5, 2.5)
		var shop = int(b.seed) % 2
		_box_into(_batch(batches, "shop%d%s" % [shop, k], shops[shop]), Vector3(w + 0.12, 3.25, d + 0.12), c + Vector3(0, 1.625, 0), 2.5, 2.5) # storefronts
		_box_into(_batch(batches, "trim" + k, trim), Vector3(w + 0.3, 0.35, d + 0.3), c + Vector3(0, 3.42, 0), 2.5, 2.5) # ledge over the shops
		_box_into(_batch(batches, "trim" + k, trim), Vector3(w + 0.5, 0.5, d + 0.5), c + Vector3(0, h - 0.1, 0), 2.5, 2.5) # cornice
		if b.tank: # a timber water tank on legs, New York style
			var t = c + Vector3((int(b.seed) % 3 - 1) * w * 0.2, h, ((int(b.seed) >> 2) % 3 - 1) * d * 0.2)
			for l in [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]:
				_box_into(_batch(batches, "tank", tank_mat), Vector3(0.18, 2.2, 0.18), t + Vector3(l[0], 1.1, l[1]), 1, 1)
			for part in [[1.6, 1.6, 3.2, 3.8], [0.0, 1.75, 1.1, 5.95]]:
				var mi = MeshInstance3D.new()
				var cm = CylinderMesh.new(); cm.top_radius = part[0]; cm.bottom_radius = part[1]; cm.height = part[2]; cm.radial_segments = 14
				mi.mesh = cm
				mi.material_override = tank_mat
				mi.position = t + Vector3(0, part[3], 0)
				group.add_child(mi)
		windows.append_array(windows_of(b, night))
	for t in L.skyline:
		_box_into(_batch(batches, "far", far), Vector3(float(t.w), float(t.h), float(t.d)), Vector3(float(t.x), float(t.h) / 2, float(t.z)), 12.4, 13.2, Color(t.tint))
	for key in batches:
		var mi = MeshInstance3D.new()
		mi.mesh = batches[key].st.commit()
		mi.material_override = batches[key].mat
		if not key.ends_with("+"):
			mi.set_meta("no_shadow", true)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		group.add_child(mi)
	# real windows: a painted frame of four bars (the bottom one a deeper sill) with the glass set back
	# inside it, reflective panes, and warm lit panes at night (three MultiMeshes)
	var frame_mat = flat(Color("#b9b2a5"), 0.7, 0.0)
	var glass_mat = flat(Color("#232b31"), 0.12, 0.6)
	var lit_mat = flat(Color("#2a2216"), 0.3, 0.0, Color("#ffbf6e"), 0.75)
	var lists = {"frame": windows, "glass": windows.filter(func(w): return w[6] == 0), "lit": windows.filter(func(w): return w[6] == 1)}
	for kind in lists:
		var list = lists[kind]
		if list.is_empty():
			continue
		var mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = BoxMesh.new()
		mm.instance_count = list.size() * (4 if kind == "frame" else 1)
		for i in list.size():
			var w = list[i]
			var ww = float(w[4])
			var wh = float(w[5])
			var rot = Basis(Vector3.UP, float(w[3]))
			var pos = Vector3(float(w[0]), float(w[1]), float(w[2]))
			if kind != "frame":
				mm.set_instance_transform(i, Transform3D(rot * Basis.from_scale(Vector3(ww, wh, 0.04)), pos + rot * Vector3(0, 0, -0.02)))
				continue
			var bars = [[0, wh / 2 + 0.055, ww + 0.22, 0.11, 0.18], [0, -wh / 2 - 0.05, ww + 0.34, 0.1, 0.26], [-ww / 2 - 0.055, 0, 0.11, wh, 0.18], [ww / 2 + 0.055, 0, 0.11, wh, 0.18]]
			for k in 4:
				var bar = bars[k]
				mm.set_instance_transform(i * 4 + k, Transform3D(rot * Basis.from_scale(Vector3(bar[2], bar[3], bar[4])), pos + rot * Vector3(bar[0], bar[1], 0)))
		var mmi = MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = {"frame": frame_mat, "glass": glass_mat, "lit": lit_mat}[kind]
		mmi.set_meta("no_shadow", true)
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		group.add_child(mmi)
	# street lamps (the nearest few light up at night), parked cars, hydrants and bins
	var lights = 0
	for d in L.lamps + L.cars + L.props:
		var o = prop(d.model)
		if o == null:
			continue
		o.position = Vector3(d.p[0], d.p[1], d.p[2])
		o.rotation.y = d.ry
		group.add_child(o)
		if d.get("light", false) and night and lights < 6:
			lights += 1
			var l = OmniLight3D.new()
			l.light_color = Color("#ffd49a"); l.light_energy = 3.0; l.omni_range = 22
			l.position = Vector3(d.p[0], 5.3, d.p[2])
			group.add_child(l)
	return group

# Real-world finishes for the guns (the source models are toy-coloured): gunmetal, black polymer, oiled
# wood and olive drab, picked from each part's original colour. Same rule as gunFinish() in render3d.js.
func gun_finish(m: StandardMaterial3D) -> void:
	var c = m.albedo_color
	var l = (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b))) / 2 # HSL lightness
	var sat = 0.0 if c.s == 0 else (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) / (1 - abs(2 * l - 1) + 0.00001)
	var f
	if sat > 0.3 and c.h > 0.03 and c.h < 0.13: f = [Color("#4a2e1c"), 0.65, 0.0] # orange/brown: wood
	elif sat > 0.35: f = [Color("#3b3f33"), 0.6, 0.15] # any bright colour: olive drab
	elif l > 0.45: f = [Color("#45484c"), 0.34, 0.85] # light grey: gunmetal
	else: f = [Color("#171819"), 0.52, 0.2] # dark: black polymer
	m.albedo_color = f[0]
	m.roughness = f[1]
	m.metallic = f[2]
	m.albedo_texture = null
	m.emission_enabled = false
