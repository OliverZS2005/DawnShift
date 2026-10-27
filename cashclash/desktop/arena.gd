# Fight screen. Singleplayer runs the simulation locally against a bot; multiplayer draws the
# server's snapshots with the same lag smoothing as the web version:
# * own player: predicted locally from our unacknowledged inputs, eased toward the server's answer
# * opponent / bullets: drawn INTERP_DELAY behind the newest snapshot, blended between snapshots
extends Control

signal closed

const INTERP_DELAY = 0.1

var info := {}
var A = null            # singleplayer arena
var buf := []           # multiplayer: [{snap, at}]
var pending := []       # multiplayer: inputs the server hasn't acknowledged yet
var seq := 0
var me = null           # drawn position of our own player (multiplayer)
var my_ang := 0.0
var send_acc := 0.0
var one_shot := {}
var result = null
var view = null
var ox := 0.0
var oy := 0.0
var sc := 1.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
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
	if not info.mp:
		A = CC.new_arena(Game.sp.tycoon, CC.rival_loadout(info.rival))
	visible = true

func _finish(won: bool, text: String) -> void:
	if not visible or result != null:
		return
	result = {"won": won, "text": text}
	await get_tree().create_timer(2.5).timeout
	visible = false
	Game.in_battle = false
	A = null
	closed.emit()

func _on_snap(snap: Dictionary, ack: int) -> void:
	if not visible or not info.get("mp"):
		return
	buf.append({"snap": snap, "at": Time.get_ticks_msec()})
	while buf.size() > 2 and buf[1].snap.t < snap.t - 1.0:
		buf.pop_front()
	pending = pending.filter(func(p): return p.seq > ack)

func _unhandled_key_input(e: InputEvent) -> void:
	if not visible or not (e is InputEventKey) or not e.pressed or e.echo:
		return
	if e.keycode >= KEY_1 and e.keycode <= KEY_5:
		one_shot.sw = CC.WEAPONS[e.keycode - KEY_1].id
	elif e.keycode == KEY_R:
		one_shot.reload = true

func _move() -> Vector2:
	var x = int(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - int(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT))
	var y = int(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) - int(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP))
	return Vector2(x, y)

func _mouse_arena() -> Vector2:
	return (get_local_mouse_position() - Vector2(ox, oy)) / sc

func _read_input(pos) -> Dictionary:
	var mv = _move()
	var m = _mouse_arena()
	var inp = {"mx": mv.x, "my": mv.y, "ang": atan2(m.y - pos.y, m.x - pos.x) if pos != null else 0.0,
		"shoot": Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)}
	for k in one_shot:
		inp[k] = one_shot[k]
	one_shot = {}
	return inp

func _process(dt: float) -> void:
	if not visible:
		return
	dt = min(dt, 0.05)
	if info.mp:
		if buf.size() > 0:
			view = _interpolated(dt)
			var m = _mouse_arena()
			my_ang = atan2(m.y - me.y, m.x - me.x)
			send_acc += dt
			if result == null and send_acc >= CC.TICK:
				send_acc = 0.0
				var inp = _read_input(me)
				seq += 1
				inp.seq = seq
				pending.append({"seq": seq, "mx": inp.mx, "my": inp.my})
				Game.send({"type": "input", "input": inp})
	else:
		if result == null:
			var u = A.units[0]
			var w = CC.step_arena(A, [_read_input(u), CC.bot_input(A, 1, info.rival.skill)], dt)
			if w >= 0:
				_finish(w == 0, Game.end_sp(w == 0, info.rival))
		view = CC.snapshot(A)
	queue_redraw()

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
	us[info.you].ang = my_ang
	var age = max(0.0, rt - s0.t)
	var bs = []
	for b in s0.b:
		bs.append([b[0] + b[3] * age, b[1] + b[4] * age, b[2]])
	return {"m": last.snap.m, "u": us, "b": bs, "fx": s0.fx}

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("#07080b"))
	if view == null:
		return
	var font = get_theme_default_font()
	var top = 40.0
	sc = min((size.x - 20) / CC.W, (size.y - top - 40) / CC.H)
	ox = (size.x - CC.W * sc) / 2
	oy = top + (size.y - top - 40 - CC.H * sc) / 2
	draw_set_transform(Vector2(ox, oy), 0, Vector2(sc, sc))
	draw_rect(Rect2(0, 0, CC.W, CC.H), Color("#0d1017"))
	var gc = Color("#1a1f2b")
	for x in range(0, int(CC.W), 40):
		draw_line(Vector2(x, 0), Vector2(x, CC.H), gc)
	for y in range(0, int(CC.H), 40):
		draw_line(Vector2(0, y), Vector2(CC.W, y), gc)
	var map = CC.MAPS[int(view.m)]
	for w in map.walls:
		draw_rect(Rect2(w[0], w[1], w[2], w[3]), Color("#3a4258"))
	for j in 2:
		var u = view.u[j]
		var mine = j == info.you
		var pos = Vector2(u.x, u.y)
		var dir = Vector2.from_angle(u.ang)
		draw_line(pos + dir * 4, pos + dir * 24, Color("#cccccc"), 6)
		draw_circle(pos, 14, Color("#f5c542") if mine else Color("#f87171"))
		draw_rect(Rect2(pos.x - 20, pos.y - 28, 40, 5), Color(0, 0, 0, 0.6))
		draw_rect(Rect2(pos.x - 20, pos.y - 28, 40 * float(u.hp) / float(u.mhp), 5), Color("#4ade80") if mine else Color("#f87171"))
	for b in view.b:
		draw_circle(Vector2(b[0], b[1]), 5 if b[2] else 3, Color("#ffe28a"))
	for f in view.fx:
		draw_circle(Vector2(f[0], f[1]), f[2], Color(1, 0.6, 0.2, clamp(f[3] * 2, 0, 1)))
	draw_set_transform(Vector2.ZERO)

	var u0 = view.u[info.you]
	var u1 = view.u[1 - info.you]
	var w0 = CC.weapon(u0.g.id)
	var w1 = CC.weapon(u1.g.id)
	var hud = "🗺️ %s · YOU %s %s · %s · HP %d/%d   vs   %s %s %s · HP %d/%d   ·   Win +%s / Lose -%s" % [
		map.name, w0.icon, w0.name, "Reloading…" if u0.g.rl else "%d/%d" % [u0.g.ammo, u0.g.mag], u0.hp, u0.mhp,
		info.opp_name, w1.icon, w1.name, u1.hp, u1.mhp, CC.fmt(info.pot.win), CC.fmt(info.pot.lose)]
	draw_string(font, Vector2(0, 26), hud, HORIZONTAL_ALIGNMENT_CENTER, size.x, 15, Color("#e8ebf2"))
	draw_string(font, Vector2(0, size.y - 14), "WASD / arrows move · Mouse aim · Click/hold shoot · R reload · 1-5 switch weapon", HORIZONTAL_ALIGNMENT_CENTER, size.x, 13, Color("#8a93a8"))
	if result != null:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.7))
		draw_string(font, Vector2(0, size.y / 2 - 10), "VICTORY" if result.won else "DEFEAT", HORIZONTAL_ALIGNMENT_CENTER, size.x, 48, Color("#4ade80") if result.won else Color("#f87171"))
		draw_string(font, Vector2(0, size.y / 2 + 30), result.text, HORIZONTAL_ALIGNMENT_CENTER, size.x, 22, Color.WHITE)
