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
	e.glow_bloom = 0.06
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
# desktop versions build the same streets. Mirrors buildCity() in ../render3d.js.

# Adds a box to a SurfaceTool batch: UVs in metres / tu across and / tv up (textures keep their real
# size, and a facade photo lines up with the floors).
const _FACES = [[Vector3.RIGHT, Vector3.UP], [Vector3.LEFT, Vector3.UP], [Vector3.BACK, Vector3.UP], [Vector3.FORWARD, Vector3.UP], [Vector3.UP, Vector3.FORWARD], [Vector3.DOWN, Vector3.BACK]]
func _box_into(st: SurfaceTool, size: Vector3, c: Vector3, tu: float, tv: float) -> void:
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
			st.set_normal(n)
			st.set_uv(pts[i][1])
			st.add_vertex(pts[i][0])

func _batch(batches: Dictionary, key: String, mat: Material) -> SurfaceTool:
	if not batches.has(key):
		var st = SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		batches[key] = {"st": st, "mat": mat}
	return batches[key].st

# Photographed building fronts (ambientCG): colour, relief, roughness and metal (the glass) by day; at night
# the same building with its lights on, glowing through an emission map.
func _tex(rel: String) -> Texture2D:
	var p = asset(rel)
	return load(p) if ResourceLoader.exists(p) else null

func facade(name: String, night: bool, tint: Color) -> StandardMaterial3D:
	var key = "facade|%s|%s|%s" % [name, night, tint.to_html()]
	if _mats.has(key):
		return _mats[key]
	var m = StandardMaterial3D.new()
	var base = "textures/facade_%s_" % name
	m.albedo_texture = _tex(base + ("night.jpg" if night else "diff.jpg"))
	m.albedo_color = tint if m.albedo_texture else Color("#8a7f75")
	m.normal_enabled = true
	m.normal_texture = _tex(base + "nor.jpg")
	m.roughness_texture = _tex(base + "rough.jpg")
	m.metallic_texture = _tex(base + "metal.jpg")
	m.metallic = 1.0 if m.metallic_texture else 0.1
	m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if night:
		m.emission_enabled = true
		m.emission = Color.WHITE
		m.emission_texture = _tex(base + "emit.jpg")
		m.emission_operator = BaseMaterial3D.EMISSION_OP_MULTIPLY # (the default, add, would light the whole wall)
		m.emission_energy_multiplier = 0.55
	_mats[key] = m
	return m

# Wet asphalt: puddles (tiling noise) are glassy and darker, so they mirror the sky and the buildings.
const WET_SHADER = """
shader_type spatial;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D puddle_tex : filter_linear_mipmap, repeat_enable;
uniform vec4 tint : source_color = vec4(0.553, 0.549, 0.533, 1.0);
varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	vec2 uv = wpos.xz / 7.0;
	float n = texture(puddle_tex, wpos.xz / 34.0).r;
	float wet = smoothstep(0.6, 0.68, n);
	ALBEDO = texture(albedo_tex, uv).rgb * tint.rgb * mix(1.0, 0.45, wet);
	NORMAL_MAP = mix(texture(normal_tex, uv).rgb, vec3(0.5, 0.5, 1.0), wet * 0.8);
	ROUGHNESS = mix(0.8, 0.14, wet);
	SPECULAR = 0.5;
}
"""
var _wet: ShaderMaterial = null
func _wet_ground() -> Material:
	var albedo = _tex("textures/asphalt_diff.jpg")
	if albedo == null:
		return flat(Color("#3d3e40"), 0.8, 0.0)
	if _wet == null:
		_wet = ShaderMaterial.new()
		var sh = Shader.new()
		sh.code = WET_SHADER
		_wet.shader = sh
		var noise = FastNoiseLite.new()
		noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		noise.frequency = 0.012
		noise.fractal_octaves = 3
		var nt = NoiseTexture2D.new()
		nt.width = 256; nt.height = 256; nt.seamless = true; nt.noise = noise; nt.generate_mipmaps = true
		_wet.set_shader_parameter("albedo_tex", albedo)
		_wet.set_shader_parameter("normal_tex", _tex("textures/asphalt_nor.jpg"))
		_wet.set_shader_parameter("puddle_tex", nt)
	return _wet

# Soft dark blotch for oil stains.
var _stain: ImageTexture = null
func _stain_tex() -> ImageTexture:
	if _stain:
		return _stain
	var img = Image.create(64, 64, false, Image.FORMAT_RGBA8)
	_rng_state = 5
	var blobs = []
	for i in 9:
		blobs.append([32 + (_rng() - 0.5) * 25, 32 + (_rng() - 0.5) * 25, 15 + _rng() * 15])
	for y in 64:
		for x in 64:
			var a = 0.0
			for b in blobs:
				a = a + (1 - a) * 0.45 * clamp(1.0 - Vector2(x - b[0], y - b[1]).length() / b[2], 0.0, 1.0)
			img.set_pixel(x, y, Color(0.03, 0.027, 0.024, a))
	img.generate_mipmaps()
	_stain = ImageTexture.create_from_image(img)
	return _stain

var _rng_state := 1
func _rng() -> float:
	_rng_state = (_rng_state * 16807) % 2147483647
	return _rng_state / 2147483647.0

# The streets (wet asphalt, lane paint, crossings, stains, manholes), sidewalks, buildings with photo
# facades (storefronts, ledges, cornices and roof tanks up close), the skyline in the haze, and street
# furniture.
func city(where: String, night: bool) -> Node3D:
	var group = Node3D.new()
	var L = M.LAYOUT[where]
	var T = M.URBAN.facadeTile
	var batches = {}
	var ground = MeshInstance3D.new()
	var pm = PlaneMesh.new(); pm.size = Vector2(1000, 1000)
	ground.mesh = pm
	ground.position.y = -0.04
	ground.material_override = _wet_ground()
	group.add_child(ground)
	var pav = pbr("pavers", Color("#b7b1a7"), 2.5, 0.0, Color("#77746f"))
	for s in L.sidewalks:
		_box_into(_batch(batches, "pav", pav), Vector3(s[2] - s[0], 0.15, s[3] - s[1]), Vector3((s[0] + s[2]) / 2, 0.075, (s[1] + s[3]) / 2), 2.5, 2.5)
	var trim = pbr("concrete_wall", Color("#a9a49b"), 2.5, 0.0, Color("#8a857d"))
	var tank_mat = flat(Color("#5e4a3a"), 0.9, 0.0)
	var shops = [pbr("shutter", Color("#8d8f8c"), 2.5, 0.0, Color("#4a4c4b")), pbr("plaster", Color("#5a514a"), 2.5, 0.0, Color("#4a443e"))]
	for b in L.buildings:
		var w = float(b.w)
		var d = float(b.d)
		var h = float(b.h)
		var c = Vector3(float(b.x), 0, float(b.z))
		var k = "+" if b.shade else "" # buildings near the middle cast shadows; batched separately
		var tile = float(T[b.facade])
		_box_into(_batch(batches, b.facade + b.tint + k, facade(b.facade, night, Color(b.tint))), Vector3(w, h, d), c + Vector3(0, h / 2, 0), tile, tile)
		_box_into(_batch(batches, "trim" + k, trim), Vector3(w + 0.5, 0.5, d + 0.5), c + Vector3(0, h - 0.1, 0), 2.5, 2.5) # cornice (also the roof)
		if not b.near:
			continue
		var shop = int(b.seed) % 2
		_box_into(_batch(batches, "shop%d%s" % [shop, k], shops[shop]), Vector3(w + 0.12, 3.25, d + 0.12), c + Vector3(0, 1.625, 0), 2.5, 2.5) # storefronts
		_box_into(_batch(batches, "trim" + k, trim), Vector3(w + 0.3, 0.35, d + 0.3), c + Vector3(0, 3.42, 0), 2.5, 2.5) # ledge over the shops
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
	for t in L.skyline:
		_box_into(_batch(batches, "tower", facade("tower", night, Color(t.tint))), Vector3(float(t.w), float(t.h), float(t.d)), Vector3(float(t.x), float(t.h) / 2, float(t.z)), float(T.tower), float(T.tower))
	# road paint
	var yellow = flat(Color("#c9a227"), 0.55, 0.0)
	var white = flat(Color("#d9d6cc"), 0.55, 0.0)
	for kind in [["yellow", yellow, L.dashes], ["white", white, L.stripes]]:
		for r in kind[2]:
			_box_into(_batch(batches, kind[0], kind[1]), Vector3(r[2] - r[0], 0.01, r[3] - r[1]), Vector3((r[0] + r[2]) / 2, -0.03, (r[1] + r[3]) / 2), 1, 1)
	for key in batches:
		var mi = MeshInstance3D.new()
		mi.mesh = batches[key].st.commit()
		mi.material_override = batches[key].mat
		if not key.ends_with("+"):
			mi.set_meta("no_shadow", true)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		group.add_child(mi)
	# oil stains and manhole covers
	var stain_mat = StandardMaterial3D.new()
	stain_mat.albedo_texture = _stain_tex()
	stain_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	stain_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var spots = [[L.stains, stain_mat], [L.manholes, flat(Color("#2a2724"), 0.45, 0.7)]]
	for spot in spots:
		var mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		if spot[0] == L.stains:
			var pl = PlaneMesh.new(); pl.size = Vector2(1, 1)
			mm.mesh = pl
		else:
			var cyl = CylinderMesh.new(); cyl.top_radius = 0.42; cyl.bottom_radius = 0.42; cyl.height = 0.02; cyl.radial_segments = 20
			mm.mesh = cyl
		mm.instance_count = spot[0].size()
		for i in spot[0].size():
			var e = spot[0][i]
			var basis = Basis(Vector3.UP, float(e[3])) * Basis.from_scale(Vector3(float(e[2]), 1, float(e[2]) * 0.7)) if e.size() > 2 else Basis.IDENTITY
			mm.set_instance_transform(i, Transform3D(basis, Vector3(float(e[0]), -0.02 if e.size() > 2 else -0.03, float(e[1]))))
		var mmi = MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = spot[1]
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
