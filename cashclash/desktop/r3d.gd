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
	if n is GeometryInstance3D:
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
func environment(sky_name: String, exposure: float, fog_color: Color) -> Environment:
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
	e.glow_enabled = true
	e.glow_intensity = 0.6
	e.glow_bloom = 0.05
	e.glow_hdr_threshold = 1.2
	e.fog_enabled = true
	e.fog_light_color = fog_color
	e.fog_density = 0.004
	e.fog_sky_affect = 0.0
	return e

func sun(color: Color, energy: float) -> DirectionalLight3D:
	var d = DirectionalLight3D.new()
	d.light_color = color
	d.light_energy = energy
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
