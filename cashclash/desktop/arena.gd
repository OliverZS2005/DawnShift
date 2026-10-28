# First-person fight screen. Singleplayer runs the simulation locally against a bot; multiplayer draws
# the server's snapshots with the same lag smoothing as the web version:
# * own player: predicted locally from our unacknowledged inputs, eased toward the server's answer
# * opponent / bullets: drawn INTERP_DELAY behind the newest snapshot, blended between snapshots
# The HUD follows the web version's brief: ink plates, warm-white text, one amber accent for hit
# confirmation and critical callouts, condensed labels + monospace numbers, sharp corners.
extends Control

signal closed

const INTERP_DELAY = 0.1
const SENS = 0.0022   # radians per pixel of mouse movement
const TURN = 2.6      # radians per second on the arrow keys
const INK = Color(0.043, 0.051, 0.063, 0.74)
const EDGE = Color(0.95, 0.94, 0.91, 0.14)
const HUD = Color("#F2EFE8")
const DIM = Color("#B9B4AA")
const AMBER = Color("#FFB020")
const FOE = Color("#e2584b")
const YOU = Color("#4f8ff0")
const OK = Color("#4ade80")
const LOW = Color("#f87171")

var info := {}
var A = null            # singleplayer arena
var buf := []           # multiplayer: [{snap, at}]
var pending := []       # multiplayer: inputs the server hasn't acknowledged yet
var seq := 0
var me = null           # drawn position of our own player (multiplayer)
var send_acc := 0.0
var one_shot := {}
var result = null
var view = null
var view3d            # arena3d.gd: the 3D scene
var overlay: Control  # HUD, drawn on top of the 3D view
var yaw = null        # where you face (game angle)
var pitch := 0.0      # looking up/down (visual only)
var force_shoot := false # lets automated tests fire without a real mouse
var started := 0
var hit_t := 0.0
var hurt_t := 0.0
var foe_seen := -100000
var foe_ammo := -1

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	view3d = preload("res://arena3d.gd").new()
	view3d.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	view3d.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(view3d)
	overlay = Control.new()
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.draw.connect(_draw_overlay)
	add_child(overlay)
	Game.snap_received.connect(_on_snap)
	Game.battle_result.connect(func(won, text): _finish(won, text))

func open(i: Dictionary) -> void:
	info = i
	buf = []
	pending = []
	seq = 0
	me = null
	result = null
	view = null
	one_shot = {}
	yaw = null
	pitch = 0.0
	foe_seen = -100000
	foe_ammo = -1
	started = Time.get_ticks_msec()
	if not info.mp:
		A = CC.new_arena(Game.sp.tycoon, CC.rival_loadout(info.rival))
		yaw = A.units[0].ang
	view3d.reset()
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _finish(won: bool, text: String) -> void:
	if not visible or result != null:
		return
	result = {"won": won, "text": text}
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	await get_tree().create_timer(2.5).timeout
	visible = false
	Game.in_battle = false
	A = null
	closed.emit()

func _on_snap(snap: Dictionary, ack: int) -> void:
	if not visible or not info.get("mp"):
		return
	if yaw == null:
		yaw = float(snap.u[info.you].ang) # face the way the server spawned you
	buf.append({"snap": snap, "at": Time.get_ticks_msec()})
	while buf.size() > 2 and buf[1].snap.t < snap.t - 1.0:
		buf.pop_front()
	pending = pending.filter(func(p): return p.seq > ack)

# ---------- Input ----------
func _captured() -> bool:
	return Input.mouse_mode == Input.MOUSE_MODE_CAPTURED

func _input(e: InputEvent) -> void:
	if not visible or result != null:
		return
	if e is InputEventMouseMotion and _captured() and yaw != null:
		var o = R3D.opts()
		var k = SENS * o.sens / 100.0
		yaw += e.relative.x * k
		pitch = clamp(pitch - e.relative.y * k * (-1 if o.invert else 1), -0.6, 0.45)
	elif e is InputEventMouseButton and e.pressed and not _captured():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED # first click takes aim; later clicks fire
		get_viewport().set_input_as_handled()
	elif e is InputEventKey and e.pressed and not e.echo:
		if e.keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		elif e.keycode >= KEY_1 and e.keycode <= KEY_5:
			one_shot.sw = CC.WEAPONS[e.keycode - KEY_1].id
		elif e.keycode == KEY_R:
			one_shot.reload = true

func _key(k) -> bool:
	return Input.is_physical_key_pressed(k)

# Movement keys are relative to where you face; the game itself moves in map directions.
func _move() -> Vector2:
	var f = int(_key(KEY_W) or _key(KEY_UP)) - int(_key(KEY_S) or _key(KEY_DOWN))
	var r = int(_key(KEY_D)) - int(_key(KEY_A))
	var a = yaw if yaw != null else 0.0
	return Vector2(f * cos(a) - r * sin(a), f * sin(a) + r * cos(a))

func _read_input() -> Dictionary:
	var mv = _move()
	var inp = {"mx": mv.x, "my": mv.y, "ang": yaw if yaw != null else 0.0,
		"shoot": force_shoot or (_captured() and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))}
	for k in one_shot:
		inp[k] = one_shot[k]
	one_shot = {}
	return inp

# ---------- Frame ----------
func _process(dt: float) -> void:
	if not visible:
		return
	dt = min(dt, 0.05)
	if yaw != null:
		yaw += (int(_key(KEY_RIGHT)) - int(_key(KEY_LEFT))) * TURN * dt # keyboard turning
	if info.mp:
		if buf.size() > 0:
			view = _interpolated(dt)
			send_acc += dt
			if result == null and send_acc >= CC.TICK:
				send_acc = 0.0
				var inp = _read_input()
				seq += 1
				inp.seq = seq
				pending.append({"seq": seq, "mx": inp.mx, "my": inp.my})
				Game.send({"type": "input", "input": inp})
	else:
		if result == null:
			var w = CC.step_arena(A, [_read_input(), CC.bot_input(A, 1, info.rival.skill)], dt)
			if w >= 0:
				_finish(w == 0, Game.end_sp(w == 0, info.rival))
		view = CC.snapshot(A)
	if view != null:
		view3d.update(view, info.you, ["You", info.opp_name], dt, pitch)
		if view3d.events.hit_enemy:
			hit_t = 0.22
		if view3d.events.hurt:
			hurt_t = 0.45
	hit_t -= dt
	hurt_t -= dt
	overlay.queue_redraw()

func _predict_me(dt_live: float) -> Vector2:
	var latest = buf[-1].snap
	var u = latest.u[info.you]
	var p = {"x": float(u.x), "y": float(u.y)}
	var walls = CC.MAPS[int(latest.m)].walls
	for inp in pending:
		CC.move_unit(walls, p, inp.mx, inp.my, u.sp, CC.TICK)
	# plus the movement held since the last send, so we move every frame, not every 1/30s
	var mv = _move()
	CC.move_unit(walls, p, mv.x, mv.y, u.sp, dt_live)
	return Vector2(p.x, p.y)

func _interpolated(dt: float) -> Dictionary:
	var last = buf[-1]
	var rt = float(last.snap.t) + (Time.get_ticks_msec() - last.at) / 1000.0 - INTERP_DELAY
	var i = buf.size() - 1
	while i > 0 and buf[i].snap.t > rt:
		i -= 1
	var s0 = buf[i].snap
	var s1 = buf[min(i + 1, buf.size() - 1)].snap
	var k = clamp((rt - s0.t) / (s1.t - s0.t), 0.0, 1.0) if s1.t > s0.t else 1.0
	var us = []
	for j in 2:
		var u = last.snap.u[j].duplicate()
		u.x = lerp(float(s0.u[j].x), float(s1.u[j].x), k)
		u.y = lerp(float(s0.u[j].y), float(s1.u[j].y), k)
		u.ang = lerp_angle(float(s0.u[j].ang), float(s1.u[j].ang), k)
		us.append(u)
	var target = _predict_me(min(send_acc + dt, CC.TICK))
	if me == null or me.distance_to(target) > 120:
		me = target
	else:
		me = me.lerp(target, min(1.0, dt * 18.0))
	us[info.you].x = me.x
	us[info.you].y = me.y
	us[info.you].ang = yaw
	var age = max(0.0, rt - s0.t)
	var bs = []
	for b in s0.b:
		bs.append([b[0] + b[3] * age, b[1] + b[4] * age, b[2], b[3], b[4]])
	return {"m": last.snap.m, "u": us, "b": bs, "fx": s0.fx}

# ---------- HUD ----------
func _plate(r: Rect2) -> void:
	overlay.draw_rect(r, INK)
	overlay.draw_rect(r, EDGE, false, 1.0)

func _meter(r: Rect2, frac: float, col: Color) -> void:
	overlay.draw_rect(r, Color(HUD, 0.12))
	overlay.draw_rect(Rect2(r.position, Vector2(r.size.x * clamp(frac, 0.0, 1.0), r.size.y)), col)

func _text(pos: Vector2, s: String, f: Font, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	overlay.draw_string(f, pos, s, align, width, size, col)

func _draw_overlay() -> void:
	if view == null:
		overlay.draw_rect(Rect2(Vector2.ZERO, size), Color("#07080b"))
		return
	var label_f = R3D.font("barlow-condensed-600")
	var bold_f = R3D.font("barlow-condensed-800")
	var num_f = R3D.font("jetbrains-mono-700")
	var mono_f = R3D.font("jetbrains-mono-500")
	var u0 = view.u[info.you]
	var u1 = view.u[1 - info.you]
	var gun = CC.weapon(u0.g.id)
	var foe_gun = CC.weapon(u1.g.id)
	var W = size.x
	var H = size.y
	# damage flash and critical-health edges
	var hp = clamp(float(u0.hp) / max(1.0, float(u0.mhp)), 0.0, 1.0)
	var red = max(hurt_t / 0.45, 0.45 if hp > 0 and hp <= 0.25 else 0.0)
	if red > 0:
		for k in 10:
			var inset = k * 14.0
			overlay.draw_rect(Rect2(inset, inset, W - inset * 2, H - inset * 2), Color(0.89, 0.2, 0.16, red * 0.09 * (1.0 - k / 10.0)), false, 14.0)
	# crosshair: four ticks whose gap opens with weapon spread and movement
	var c = Vector2(W / 2, H / 2)
	var moving = 1.0 if _move().length() > 0 else 0.0
	var gap = round(5 + float(gun.spread) * 70 + moving * 5)
	var tick = Color(R3D.M.SETTINGS.CROSSHAIR[R3D.opts().crosshair])
	for d in [Vector2(0, -1), Vector2(0, 1), Vector2(-1, 0), Vector2(1, 0)]:
		var a = c + d * gap
		var b = c + d * (gap + 9)
		overlay.draw_line(a, b, Color(0, 0, 0, 0.6), 4.0)
		overlay.draw_line(a, b, tick, 2.0)
	if hit_t > 0:
		var s = 9 + (hit_t / 0.22) * 3
		var col = Color(AMBER, hit_t / 0.22)
		overlay.draw_line(c + Vector2(-s, -s), c + Vector2(-4, -4), col, 2.0)
		overlay.draw_line(c + Vector2(s, -s), c + Vector2(4, -4), col, 2.0)
		overlay.draw_line(c + Vector2(-s, s), c + Vector2(-4, 4), col, 2.0)
		overlay.draw_line(c + Vector2(s, s), c + Vector2(4, 4), col, 2.0)
	# opponent, top centre
	var fr = Rect2(W / 2 - 130, 16, 260, 62)
	_plate(fr)
	_text(fr.position + Vector2(14, 32), str(info.opp_name), bold_f, 22, HUD)
	_text(fr.position + Vector2(14, 32), foe_gun.name.to_upper(), label_f, 14, DIM, HORIZONTAL_ALIGNMENT_RIGHT, fr.size.x - 28)
	_meter(Rect2(fr.position + Vector2(14, 44), Vector2(fr.size.x - 28, 5)), float(u1.hp) / max(1.0, float(u1.mhp)), FOE)
	var stakes = "%s · win +%s · lose -%s" % [CC.MAPS[int(view.m)].name, CC.fmt(info.pot.win), CC.fmt(info.pot.lose)]
	var sw = mono_f.get_string_size(stakes, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x + 20
	_plate(Rect2(W / 2 - sw / 2, 86, sw, 26))
	_text(Vector2(W / 2 - sw / 2 + 10, 104), stakes, mono_f, 13, HUD)
	# you: health bottom-left, weapon bottom-right
	var vr = Rect2(16, H - 16 - 98, 200, 98)
	_plate(vr)
	_text(vr.position + Vector2(14, 24), "HEALTH", label_f, 14, DIM)
	_text(vr.position + Vector2(14, 70), str(max(0, int(ceil(float(u0.hp))))), num_f, 44, LOW if hp <= 0.35 else HUD)
	_meter(Rect2(vr.position + Vector2(14, 82), Vector2(vr.size.x - 28, 6)), hp, LOW if hp <= 0.35 else OK)
	var ar = Rect2(W - 16 - 210, H - 16 - 98, 210, 98)
	_plate(ar)
	var reloading = bool(u0.g.rl)
	var low_ammo = not reloading and int(u0.g.ammo) <= int(ceil(int(u0.g.mag) * 0.25))
	_text(ar.position + Vector2(0, 24), "AMMO", label_f, 14, DIM, HORIZONTAL_ALIGNMENT_RIGHT, ar.size.x - 14)
	var mag = "/ %d" % int(u0.g.mag)
	var mag_w = mono_f.get_string_size(mag, HORIZONTAL_ALIGNMENT_LEFT, -1, 18).x
	_text(ar.position + Vector2(0, 66), mag, mono_f, 18, DIM, HORIZONTAL_ALIGNMENT_RIGHT, ar.size.x - 14)
	_text(ar.position + Vector2(0, 66), "–" if reloading else str(int(u0.g.ammo)), num_f, 44, AMBER if low_ammo else HUD, HORIZONTAL_ALIGNMENT_RIGHT, ar.size.x - 20 - mag_w)
	_text(ar.position + Vector2(0, 90), "Reloading" if reloading else gun.name, bold_f, 20, AMBER if reloading else HUD, HORIZONTAL_ALIGNMENT_RIGHT, ar.size.x - 14)
	if R3D.opts().minimap:
		_minimap(Rect2(W - 16 - 225, 16, 225, 140), u0, u1)
	# opponent tag over their head, only while you can actually see them (walls hide it)
	var tag = view3d.foe_tag()
	var walls = CC.MAPS[int(view.m)].walls
	if tag != null and int(u1.hp) > 0 and CC.line_clear(walls, {"x": float(u0.x), "y": float(u0.y)}, {"x": float(u1.x), "y": float(u1.y)}):
		_text(tag + Vector2(-100, -10), str(info.opp_name), label_f, 18, HUD, HORIZONTAL_ALIGNMENT_CENTER, 200)
		overlay.draw_rect(Rect2(tag + Vector2(-40, -4), Vector2(80, 6)), INK)
		_meter(Rect2(tag + Vector2(-39, -3), Vector2(78, 4)), float(u1.hp) / max(1.0, float(u1.mhp)), OK if float(u1.hp) / max(1.0, float(u1.mhp)) > 0.35 else LOW)
	# controls hint (fades after a few seconds) and the aim prompt while the mouse is free
	var age = (Time.get_ticks_msec() - started) / 1000.0
	if age < 7.2 and R3D.opts().hints:
		var alpha = clamp(7.2 - age, 0.0, 1.0)
		var tip = "W A S D move · mouse looks · click fires · R reload · 1–5 weapons · Esc frees the mouse"
		var tw = label_f.get_string_size(tip, HORIZONTAL_ALIGNMENT_LEFT, -1, 15).x + 24
		overlay.draw_rect(Rect2(W / 2 - tw / 2, H - 16 - 30, tw, 30), Color(INK, INK.a * alpha))
		_text(Vector2(W / 2 - tw / 2 + 12, H - 16 - 10), tip, label_f, 15, Color(DIM, alpha))
	if not _captured() and result == null:
		var pr = Rect2(W / 2 - 230, H * 0.58, 460, 70)
		_plate(pr)
		_text(pr.position + Vector2(0, 32), "Click to take aim", bold_f, 26, HUD, HORIZONTAL_ALIGNMENT_CENTER, pr.size.x)
		_text(pr.position + Vector2(0, 56), "Your mouse turns your head. Press Esc any time to get the cursor back.", label_f, 16, DIM, HORIZONTAL_ALIGNMENT_CENTER, pr.size.x)
	if result != null:
		overlay.draw_rect(Rect2(Vector2.ZERO, size), Color(0.027, 0.03, 0.043, 0.62))
		_text(Vector2(0, H / 2 + 10), "Victory" if result.won else "Defeat", bold_f, 84, OK if result.won else LOW, HORIZONTAL_ALIGNMENT_CENTER, W)
		_text(Vector2(0, H / 2 + 50), result.text, mono_f, 18, HUD, HORIZONTAL_ALIGNMENT_CENTER, W)

# Overhead map: walls, you (an arrow) and the opponent, shown only while you can see them
# or for a moment after they fire (no wall-hacks).
func _minimap(r: Rect2, u0, u1) -> void:
	_plate(r)
	var k = r.size.x / CC.W
	var walls = CC.MAPS[int(view.m)].walls
	for w in walls:
		overlay.draw_rect(Rect2(r.position + Vector2(w[0], w[1]) * k, Vector2(w[2], w[3]) * k), Color(HUD, 0.5))
	if int(u1.g.ammo) != foe_ammo:
		if foe_ammo >= 0 and int(u1.g.ammo) < foe_ammo:
			foe_seen = Time.get_ticks_msec()
		foe_ammo = int(u1.g.ammo)
	var a = {"x": float(u0.x), "y": float(u0.y)}
	var b = {"x": float(u1.x), "y": float(u1.y)}
	if int(u1.hp) > 0 and (CC.line_clear(walls, a, b) or Time.get_ticks_msec() - foe_seen < 900):
		overlay.draw_circle(r.position + Vector2(b.x, b.y) * k, 4.0, FOE)
	var p = r.position + Vector2(a.x, a.y) * k
	var ang = yaw if yaw != null else float(u0.ang)
	var pts = PackedVector2Array()
	for q in [Vector2(7, 0), Vector2(-5, -5), Vector2(-2, 0), Vector2(-5, 5)]:
		pts.append(p + q.rotated(ang))
	overlay.draw_colored_polygon(pts, YOU)
