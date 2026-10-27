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
	# Work out the terrain and grass for the city and every fight map now, on worker threads, so
	# neither the city nor the first fight waits for it. (Same arguments city3d.gd and arena3d.gd use.)
	var LS = M.LANDSCAPE
	var city_bare = 1.5 * float(M.CITY.lot) + float(M.CITY.road)
	_prewarm(LS.flatCity, [city_bare, city_bare], [2000])
	var seeds = []
	for m in M.ARENA.themes.size():
		seeds.append(1000 + m)
	_prewarm(LS.flatArena, [LS.flatArena[0] - 2, LS.flatArena[1] - 2], seeds)

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
	e.glow_enabled = true
	e.glow_intensity = 0.6
	e.glow_bloom = 0.05
	e.glow_hdr_threshold = 1.2
	# aerial perspective: distant hills fade into the sky's haze colour. Depth fog rather than
	# exponential: it leaves the arena itself clear and works the same in the OpenGL fallback.
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_light_color = Color(M.LANDSCAPE.haze[sky_name])
	e.fog_density = 1.0
	e.fog_depth_begin = 60.0
	e.fog_depth_end = 650.0
	e.fog_depth_curve = 1.6
	e.fog_sky_affect = 0.0
	# colour grade: a little extra saturation (the web version also adds warmth and a vignette)
	e.adjustment_enabled = true
	e.adjustment_saturation = 1.12
	# Vulkan (Forward+) only; the OpenGL fallback ignores these. (No SDFGI: outdoors it darkened the
	# shade more than it added bounce light, and it's the costliest effect on weaker graphics cards.)
	# Bounce light and contact shading from what's on screen, and reflections on smooth floors.
	e.ssil_enabled = true
	e.ssil_radius = 4.0
	e.ssil_intensity = 0.8
	e.ssr_enabled = true
	e.ssr_max_steps = 48
	e.ssr_fade_out = 1.5
	# Thin volumetric haze: the air catches the sunlight (soft light shafts past walls and trees).
	e.volumetric_fog_enabled = true
	e.volumetric_fog_density = 0.006
	e.volumetric_fog_albedo = Color(M.LANDSCAPE.haze[sky_name])
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

# ---------- Landscape: rolling hills, mountains, wind-blown grass, trees ----------
# Same maths as terrainHeight() in ../models.js, so both versions raise identical hills.
# Four octaves of smoothed value noise (hash and interpolation inlined: this runs ~100k times per build).
func _fbm(x: float, z: float) -> float:
	var s = 0.0
	var a = 0.5
	for o in 4:
		var i = floor(x)
		var j = floor(z)
		var fx = x - i
		var fz = z - j
		var u = fx * fx * (3 - 2 * fx)
		var w = fz * fz * (3 - 2 * fz)
		var h = sin(i * 127.1 + j * 311.7) * 43758.5453
		var ha = h - floor(h)
		h = sin((i + 1) * 127.1 + j * 311.7) * 43758.5453
		var hb = h - floor(h)
		h = sin(i * 127.1 + (j + 1) * 311.7) * 43758.5453
		var hc = h - floor(h)
		h = sin((i + 1) * 127.1 + (j + 1) * 311.7) * 43758.5453
		var hd = h - floor(h)
		s += a * (ha + (hb - ha) * u + (hc - ha) * w + (ha - hb - hc + hd) * u * w)
		x *= 2
		z *= 2
		a *= 0.5
	return s

func terrain_height(x: float, z: float, flat: Array) -> float:
	var L = M.LANDSCAPE
	var dx = max(0.0, abs(x) - flat[0])
	var dz = max(0.0, abs(z) - flat[1])
	var r = min(1.0, sqrt(dx * dx + dz * dz) / L.ramp)
	var y = -0.05
	if r > 0: # zero on the level ground, so skip the noise there
		y += r * r * (3 - 2 * r) * _fbm(x * L.hillScale + 11, z * L.hillScale + 7) * L.hills * 2
	var m = clamp((sqrt(x * x + z * z) - L.mountainStart) / 120.0, 0.0, 1.0)
	if m > 0:
		var f = _fbm(x * L.mountainScale + 3, z * L.mountainScale + 5)
		y += f * f * L.mountains * 2 * m
	return y

const GRASS_SHADER = """
shader_type spatial;
render_mode cull_disabled;
void vertex() {
	vec3 ip = MODEL_MATRIX[3].xyz;
	float k = VERTEX.y * VERTEX.y;
	float gust = sin(TIME * 1.5 + ip.x * 0.19 + ip.z * 0.13) * 0.65 + sin(TIME * 3.4 + ip.x * 1.1 + ip.z * 0.8) * 0.22;
	vec3 wind = vec3(1.0, 0.0, 0.42) * (gust + 0.35) * k * 0.42;
	VERTEX += inverse(mat3(MODEL_MATRIX)) * wind;
}
void fragment() {
	// both sides lit like the ground beneath (Godot would flip the back face's normal downward: black blades)
	NORMAL = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.82;
	// thin blades let light through: they glow when the sun is behind them (Vulkan renderer)
	BACKLIGHT = COLOR.rgb * 0.6;
}
"""

var _rng_state := 1
func _rng() -> float:
	_rng_state = (_rng_state * 16807) % 2147483647
	return _rng_state / 2147483647.0

# One grass blade, 1 unit tall: a tapering strip, dark at the root and sunlit at the tip.
var _blade: ArrayMesh = null
func _grass_blade() -> ArrayMesh:
	if _blade:
		return _blade
	var st = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segs = 4
	var rows = []
	for i in segs + 1:
		var y = float(i) / segs
		var w = 0.045 * (1 - y * 0.9)
		var bend = y * y * 0.12
		var k = pow(y, 1.4)
		var c = Color(0.035, 0.09, 0.015).lerp(Color(0.32, 0.5, 0.1), k)
		rows.append([Vector3(-w, y, bend), Vector3(w, y, bend), c])
	for i in segs:
		var a = rows[i]
		var b = rows[i + 1]
		for v in [[a[0], a[2]], [a[1], a[2]], [b[0], b[2]], [a[1], a[2]], [b[1], b[2]], [b[0], b[2]]]:
			st.set_color(v[1])
			st.set_normal(Vector3.UP) # up-facing normals: soft, sky-lit grass
			st.add_vertex(v[0])
	_blade = st.commit()
	return _blade

# flat: half-extents of the level ground; bare: half-extents with no grass (paving).
# Returns {group, flat, grass}.
# Built meshes are cached (terrain per level-ground size, grass per seed): rebuilding takes seconds.
var _terrain_cache := {}
var _grass_cache := {}
func landscape(flat: Array, bare: Array, seed: int) -> Dictionary:
	var group = Node3D.new()
	var t = _terrain(flat)
	var ground = MeshInstance3D.new()
	ground.mesh = t.mesh
	ground.material_override = t.material
	group.add_child(ground)
	var gkey = "%s|%s|%d" % [flat, bare, seed]
	if not _grass_cache.has(gkey):
		var buf = _grass_buffers[gkey] if _grass_buffers.has(gkey) else _grass_buffer(t, bare, seed)
		_grass_buffers.erase(gkey)
		var mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = _grass_blade()
		mm.instance_count = buf.size() / 16
		mm.buffer = buf
		_grass_cache[gkey] = mm
	var grass = MultiMeshInstance3D.new()
	grass.multimesh = _grass_cache[gkey]
	grass.material_override = t.grass_material
	grass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	grass.set_meta("no_shadow", true)
	group.add_child(grass)
	# trees on the hills
	var L = M.LANDSCAPE
	_rng_state = seed + 17
	for i in int(L.trees):
		var a = _rng() * TAU
		var d = 36 + pow(_rng(), 0.7) * 170
		var x = cos(a) * d
		var z = sin(a) * d
		var tname = "pine" if _rng() < 0.55 else "tree"
		var sc = 0.9 + _rng() * 0.9 + d / 260.0
		var rot = _rng() * TAU
		var o = prop(tname)
		if o:
			o.position = Vector3(x, _ground_at(t, x, z) - 0.1, z)
			o.rotation.y = rot
			o.scale *= sc
			group.add_child(o)
	return {"group": group, "flat": flat, "grass": grass}

# Height of the terrain mesh itself (linear across its triangles), so nothing floats above it.
func _ground_at(t: Dictionary, x: float, z: float) -> float:
	var n: int = t.n
	var gx = clamp((x / t.size + 0.5) * n, 0.0, n - 0.001)
	var gz = clamp((z / t.size + 0.5) * n, 0.0, n - 0.001)
	var i = int(gx)
	var j = int(gz)
	var fx = gx - i
	var fz = gz - j
	var h: PackedFloat32Array = t.heights
	var a = j * (n + 1) + i
	if fx + fz <= 1.0:
		return h[a] + (h[a + 1] - h[a]) * fx + (h[a + n + 1] - h[a]) * fz
	return h[a + n + 2] + (h[a + n + 1] - h[a + n + 2]) * (1 - fx) + (h[a + 1] - h[a + n + 2]) * (1 - fz)

var _jobs := {}
var _grass_buffers := {}
# Quitting while a job still runs would free what it reads (and crash): let them finish first.
func _exit_tree() -> void:
	for job in _jobs.values():
		WorkerThreadPool.wait_for_task_completion(job.id)
	_jobs.clear()

func _prewarm(flat: Array, bare: Array, seeds: Array) -> void:
	var job = {"grass": {}}
	job.id = WorkerThreadPool.add_task(func():
		job.heights = _height_grid(flat)
		job.arrays = _terrain_arrays(job.heights)
		var t = {"heights": job.heights, "n": int(M.LANDSCAPE.segments), "size": float(M.LANDSCAPE.size)}
		for sd in seeds:
			job.grass["%s|%s|%d" % [flat, bare, sd]] = _grass_buffer(t, bare, sd))
	_jobs[str(flat)] = job

func _height_grid(flat: Array) -> PackedFloat32Array:
	var n = int(M.LANDSCAPE.segments)
	var size = float(M.LANDSCAPE.size)
	var heights = PackedFloat32Array()
	heights.resize((n + 1) * (n + 1))
	for j in n + 1:
		for i in n + 1:
			heights[j * (n + 1) + i] = terrain_height(-size / 2 + size * i / n, -size / 2 + size * j / n, flat)
	return heights

# The terrain grid's mesh arrays: vertex colour grass (white: the texture shows), rock on steep
# slopes, snow on the high peaks. Pure maths, so it can run on a worker thread.
func _terrain_arrays(heights: PackedFloat32Array) -> Array:
	var n = int(M.LANDSCAPE.segments)
	var size = float(M.LANDSCAPE.size)
	var verts = PackedVector3Array()
	var normals = PackedVector3Array()
	var colors = PackedColorArray()
	var index = PackedInt32Array()
	verts.resize((n + 1) * (n + 1)); normals.resize(verts.size()); colors.resize(verts.size())
	var rock = Color("#8c8478")
	var snow = Color("#f4f6f8")
	for j in n + 1:
		for i in n + 1:
			var h = heights[j * (n + 1) + i]
			var hl = heights[j * (n + 1) + max(i - 1, 0)]
			var hr = heights[j * (n + 1) + min(i + 1, n)]
			var hd = heights[max(j - 1, 0) * (n + 1) + i]
			var hu = heights[min(j + 1, n) * (n + 1) + i]
			var nrm = Vector3(hl - hr, 2 * size / n, hd - hu).normalized()
			var slope = 1 - nrm.y
			var k = j * (n + 1) + i
			verts[k] = Vector3(-size / 2 + size * i / n, h, -size / 2 + size * j / n)
			normals[k] = nrm
			colors[k] = Color.WHITE.lerp(rock, smoothstep(0.18, 0.42, slope)).lerp(snow, smoothstep(55.0, 75.0, h) * (1 - slope * 0.8))
	index.resize(n * n * 6)
	var o = 0
	for j in n:
		for i in n:
			var a = j * (n + 1) + i
			index[o] = a; index[o + 1] = a + 1; index[o + 2] = a + n + 1
			index[o + 3] = a + 1; index[o + 4] = a + n + 2; index[o + 5] = a + n + 1
			o += 6
	var arrays = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = index
	return arrays

func _terrain(flat: Array) -> Dictionary:
	var key = str(flat)
	if _terrain_cache.has(key):
		return _terrain_cache[key]
	var L = M.LANDSCAPE
	var n = int(L.segments)
	var size = float(L.size)
	var heights: PackedFloat32Array
	var arrays: Array
	if _jobs.has(key):
		WorkerThreadPool.wait_for_task_completion(_jobs[key].id)
		heights = _jobs[key].heights
		arrays = _jobs[key].arrays
		_grass_buffers.merge(_jobs[key].grass)
		_jobs.erase(key)
	else:
		heights = _height_grid(flat)
		arrays = _terrain_arrays(heights)
	var mesh = ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var gm = pbr("grass", Color("#8fbf6a"), 4.0, 0.0, Color("#5f8a4a")).duplicate()
	gm.vertex_color_use_as_albedo = true
	var sm = ShaderMaterial.new()
	var sh = Shader.new()
	sh.code = GRASS_SHADER
	sm.shader = sh
	_terrain_cache[key] = {"mesh": mesh, "material": gm, "grass_material": sm, "heights": heights, "n": n, "size": size}
	return _terrain_cache[key]

# Wind-blown grass blades for one MultiMesh (swayed in GRASS_SHADER), as its raw instance buffer:
# per blade a 3x4 transform (row-major) and a colour. Pure maths, so it can run on a worker thread.
func _grass_buffer(t: Dictionary, bare: Array, seed: int) -> PackedFloat32Array:
	var L = M.LANDSCAPE
	var want = int(L.grass.high)
	var lo = float(L.grass.height[0])
	var span = float(L.grass.height[1]) - lo
	var radius = float(L.grass.radius)
	var buf = PackedFloat32Array()
	buf.resize(want * 16)
	var st = seed # Park-Miller, kept local so jobs on different threads don't share state
	var placed = 0
	var tries = 0
	while placed < want and tries < want * 3:
		tries += 1
		var r = []
		for k in 7:
			st = (st * 16807) % 2147483647
			r.append(st / 2147483647.0)
		var a = r[0] * TAU
		var d = sqrt(r[1]) * radius
		var x = cos(a) * d
		var z = sin(a) * d * 0.85
		if abs(x) < bare[0] and abs(z) < bare[1]:
			continue
		var b = Basis(Vector3.UP, r[3] * TAU).scaled(Vector3(1 + r[4] * 0.6, lo + r[2] * span, 1))
		var y = _ground_at(t, x, z) - 0.03
		var c = Color.from_hsv(0.22 + r[5] * 0.07, 0.55 + r[6] * 0.3, 0.55 + fmod(r[6] * 7.31, 1.0) * 0.35)
		var o = placed * 16
		buf[o] = b.x.x; buf[o + 1] = b.y.x; buf[o + 2] = b.z.x; buf[o + 3] = x
		buf[o + 4] = b.x.y; buf[o + 5] = b.y.y; buf[o + 6] = b.z.y; buf[o + 7] = y
		buf[o + 8] = b.x.z; buf[o + 9] = b.y.z; buf[o + 10] = b.z.z; buf[o + 11] = z
		buf[o + 12] = c.r; buf[o + 13] = c.g; buf[o + 14] = c.b; buf[o + 15] = 1.0
		placed += 1
	buf.resize(placed * 16)
	return buf
