# Game state for the desktop app: the singleplayer save, multiplayer connection and cloud sync.
# Save format and network protocol match the web version (../index.html) exactly.
extends Node

signal changed
signal toast(msg: String)
signal news(msg: String)
signal match_started(info: Dictionary)
signal snap_received(snap: Dictionary, ack: int)
signal battle_result(won: bool, text: String)

const SAVE_PATH = "user://cashclash_save.json"
const SETTINGS_PATH = "user://cashclash_settings.json"
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

var sp := {}
# server: last server typed; tokens: { serverUrl: multiplayer login }; sync: { server, code, base, at, err }
var settings := {"server": "ws://localhost:8080", "name": "", "tokens": {}, "sync": null}
var mode := "sp"
var in_battle := false

var ws: WebSocketPeer = null
var net := {}
var pending_choice := ""
var _ws_open := false

var sp_queue := -1.0
var _acc := {"save": 0.0, "event": 0.0, "sync": 0.0}
var _sync_busy := false

# ---------- Lifecycle ----------
func _ready() -> void:
	randomize()
	_load()
	var earned = CC.offline_earnings(sp.tycoon, (CC.now_ms() - float(sp.get("last", CC.now_ms()))) / 1000.0)
	if earned > 1:
		sp.tycoon.money += earned
		_toast_later("Welcome back! Offline earnings: " + CC.fmt(earned))
	get_tree().set_auto_accept_quit(false)
	_toast_later("")
	sync_now(true)

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		save_sp()
		await sync_now(true)
		get_tree().quit()

func _toast_later(msg: String) -> void:
	await get_tree().create_timer(0.3).timeout
	if msg != "":
		toast.emit(msg)

func fresh_sp() -> Dictionary:
	return {"tycoon": CC.new_tycoon(), "rivals": CC.new_rivals(), "wins": 0, "losses": 0, "log": [], "last": CC.now_ms()}

func _read_json(path: String):
	if not FileAccess.file_exists(path):
		return null
	var f = FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(f.get_as_text()) if f else null

# Godot keeps user:// in a folder named after the game, so the old names' folders hold older saves:
# copy them over once.
func _move_old_saves() -> void:
	var dir = OS.get_user_data_dir()
	for old in ["DawnShift", "Cash Clash"]:
		var from = dir.get_base_dir().path_join(old)
		for p in [SAVE_PATH, SETTINGS_PATH]:
			var file = p.get_file()
			if not FileAccess.file_exists(p) and FileAccess.file_exists(from.path_join(file)):
				DirAccess.copy_absolute(from.path_join(file), dir.path_join(file))

func _load() -> void:
	_move_old_saves()
	var s = _read_json(SAVE_PATH)
	sp = s if typeof(s) == TYPE_DICTIONARY and s.has("tycoon") else fresh_sp()
	_normalize_sp()
	var st = _read_json(SETTINGS_PATH)
	if typeof(st) == TYPE_DICTIONARY:
		for k in st:
			settings[k] = st[k]

func _normalize_sp() -> void:
	sp.tycoon = CC.upgrade_save(sp.tycoon)
	if typeof(sp.get("rivals")) != TYPE_ARRAY or sp.rivals.is_empty():
		sp.rivals = CC.new_rivals()
	for k in ["wins", "losses"]:
		sp[k] = int(sp.get(k, 0))
	if typeof(sp.get("log")) != TYPE_ARRAY:
		sp.log = []

func save_sp() -> void:
	sp.last = CC.now_ms()
	var f = FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f: f.store_string(JSON.stringify(sp))

func save_settings() -> void:
	var f = FileAccess.open(SETTINGS_PATH, FileAccess.WRITE)
	if f: f.store_string(JSON.stringify(settings))

func reset_sp() -> void:
	sp = fresh_sp()
	save_sp()
	toast.emit("Singleplayer game reset")
	changed.emit()

# ---------- Tick ----------
func _process(dt: float) -> void:
	# Singleplayer keeps earning in the background, even while you're on a server.
	sp.tycoon.money += CC.income(sp.tycoon) * dt
	for r in sp.rivals:
		var n = CC.tick_rival(r, dt)
		if n != "" and mode == "sp":
			news.emit("📰 " + n)
	_acc.event += dt
	if _acc.event >= 1.0:
		_acc.event = 0.0
		var ev = CC.roll_event(sp.tycoon)
		if ev != "" and mode == "sp":
			_event_toast(ev)
	_acc.save += dt
	if _acc.save > 5.0:
		_acc.save = 0.0
		save_sp()
	_acc.sync += dt
	if _acc.sync > 20.0:
		_acc.sync = 0.0
		sync_now(true)
	_poll_net()
	_tick_sp_queue(dt)

func _event_toast(type: String) -> void:
	var e = CC.EVENTS[type]
	toast.emit("%s %s! %s" % [e.icon, e.name, e.desc])
	changed.emit()

# ---------- Current mode ----------
func tycoon() -> Dictionary:
	if mode == "mp" and net.get("state"):
		return net.state.tycoon
	return sp.tycoon

func act(a: Dictionary) -> void:
	if mode == "mp":
		send({"type": "action", "action": a})
		return
	var err = CC.apply_action(sp.tycoon, a)
	if err != "":
		toast.emit(err)
	save_sp()
	changed.emit()

# ---------- Singleplayer matchmaking & battles ----------
func queue_sp() -> void:
	if sp.tycoon.money < 10:
		toast.emit("You need at least $10 to battle")
		return
	sp_queue = 0.0

func sp_queue_status() -> String:
	if sp_queue < 0: return ""
	return "Searching… %.1fs (range ±%.2f orders of magnitude)" % [sp_queue, CC.search_window(sp_queue)]

func _tick_sp_queue(dt: float) -> void:
	if sp_queue < 0 or mode != "sp":
		return
	sp_queue += dt
	if sp_queue < 0.8:
		return
	# recently fought rivals count as further away so you don't face the same one every time
	var best = null
	var best_d = INF
	for r in sp.rivals:
		var d = CC.match_distance(r, sp.tycoon) + (0.5 if int(r.get("recent", 0)) > 0 else 0.0)
		if d < best_d:
			best_d = d
			best = r
	if best_d <= CC.search_window(sp_queue):
		sp_queue = -1.0
		in_battle = true
		match_started.emit({"mp": false, "rival": best, "opp_name": best.name, "you": 0,
			"pot": {"win": best.money * CC.STEAL, "lose": sp.tycoon.money * CC.STEAL}})

func end_sp(won: bool, r: Dictionary) -> String:
	for x in sp.rivals:
		x.recent = max(0, int(x.get("recent", 0)) - 1)
	r.recent = 3
	var t: String
	if won:
		var gain = r.money * CC.STEAL
		r.money -= gain
		sp.tycoon.money += gain
		sp.wins += 1
		CC.record_win(sp.tycoon)
		t = "Beat %s → +%s" % [r.name, CC.fmt(gain)]
	else:
		var loss = sp.tycoon.money * CC.STEAL
		sp.tycoon.money -= loss
		r.money += loss
		sp.losses += 1
		t = "Lost to %s → -%s" % [r.name, CC.fmt(loss)]
	sp.log.append({"t": t, "w": won})
	if sp.log.size() > 50:
		sp.log = sp.log.slice(-50)
	save_sp()
	return t

# ---------- Multiplayer ----------
func norm_url(u: String) -> String:
	u = u.strip_edges()
	while u.ends_with("/"):
		u = u.left(-1)
	if not (u.begins_with("ws://") or u.begins_with("wss://")):
		u = u.trim_prefix("http://").trim_prefix("https://")
		var local = u.begins_with("localhost") or RegEx.create_from_string("^[\\d.]+(:\\d+)?$").search(u) != null
		u = ("ws://" if local else "wss://") + u
	return u

func http_base(u: String) -> String:
	return norm_url(u).replace("ws://", "http://").replace("wss://", "https://")

func connect_server(url: String, choice: String = "") -> void:
	url = norm_url(url)
	var token = settings.tokens.get(url, "")
	if token == "" and choice == "":
		pending_choice = url
		changed.emit()
		return
	pending_choice = ""
	disconnect_server()
	ws = WebSocketPeer.new()
	if ws.connect_to_url(url) != OK:
		ws = null
		toast.emit("Invalid server address")
		return
	_ws_open = false
	net = {"url": url, "token": token, "choice": choice, "state": null, "board": [], "queue": "idle", "connecting": true}
	changed.emit()

func disconnect_server() -> void:
	if ws:
		ws.close()
	ws = null
	net = {}
	if mode == "mp":
		mode = "sp"
	changed.emit()

func send(m: Dictionary) -> void:
	if ws and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(m))

func _poll_net() -> void:
	if ws == null:
		return
	ws.poll()
	var st = ws.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN and not _ws_open:
		_ws_open = true
		var hello = {"type": "hello", "token": net.token, "name": settings.name}
		if net.choice != "":
			hello.mode = net.choice
		if net.choice == "import":
			hello.tycoon = sp.tycoon
		send(hello)
	while ws and ws.get_available_packet_count() > 0:
		var m = JSON.parse_string(ws.get_packet().get_string_from_utf8())
		if typeof(m) == TYPE_DICTIONARY:
			_on_net(m)
	if ws and st == WebSocketPeer.STATE_CLOSED:
		var was_connecting = net.get("connecting", false)
		ws = null
		net = {}
		if mode == "mp":
			mode = "sp"
			toast.emit("Disconnected from server — back to singleplayer")
		elif was_connecting:
			toast.emit("Could not reach the server")
		if in_battle:
			battle_result.emit(false, "Disconnected")
		changed.emit()

func _on_net(m: Dictionary) -> void:
	match m.type:
		"welcome":
			settings.tokens[net.url] = m.token
			save_settings()
			net.connecting = false
			net.state = m.state
			net.server = m.server
			mode = "mp"
			toast.emit("Joined " + m.server)
			changed.emit()
		"needMode":
			var url = net.url
			settings.tokens.erase(url)
			save_settings()
			disconnect_server()
			pending_choice = url
			toast.emit("This server has no profile for you yet")
			changed.emit()
		"state":
			net.state = m.state
		"board":
			net.board = m.board
			net.you = m.you
			net.online = m.online
			changed.emit()
		"queue":
			net.queue = m.status
			net.queue_text = "Searching… %.1fs · range ±%.2f orders of magnitude · %d in queue" % [m.wait, m.window, m.inQueue] if m.status == "searching" else ""
		"match":
			net.queue = "idle"
			in_battle = true
			match_started.emit({"mp": true, "you": int(m.you), "opp_name": m.opp.name, "pot": m.pot})
		"snap":
			snap_received.emit(m.snap, int(m.get("ack", 0)))
		"result":
			var txt = "%s %s → %s%s" % ["Beat" if m.won else "Lost to", m.opp, "+" if m.won else "-", CC.fmt(m.amount)]
			if m.get("reason"):
				txt += " (%s)" % m.reason
			battle_result.emit(m.won, txt)
		"event":
			_event_toast(m.event)
		"toast", "error":
			toast.emit(m.msg)

# ---------- Cloud sync (web <-> desktop) ----------
# Same scheme as the web version: push the save with the version we last saw; on 409 another
# device saved since, so load its save instead of overwriting it.
func _http(method: int, url: String, body: String = "") -> Dictionary:
	var req = HTTPRequest.new()
	req.timeout = 10.0
	add_child(req)
	var err = req.request(url, ["Content-Type: application/json"], method, body)
	if err != OK:
		req.queue_free()
		return {"code": 0, "body": null}
	var res = await req.request_completed
	req.queue_free()
	return {"code": res[1], "body": JSON.parse_string(res[3].get_string_from_utf8()) if res[3].size() else null}

func _sync_blob() -> Dictionary:
	sp.last = CC.now_ms()
	return {"sp": sp, "tokens": settings.tokens}

func adopt_save(save) -> void:
	if typeof(save) != TYPE_DICTIONARY:
		return
	if typeof(save.get("sp")) == TYPE_DICTIONARY and save.sp.has("tycoon"):
		sp = save.sp
		_normalize_sp()
	if typeof(save.get("tokens")) == TYPE_DICTIONARY:
		for k in save.tokens:
			settings.tokens[k] = save.tokens[k]
	save_sp()
	save_settings()
	changed.emit()

func sync_now(quiet: bool = false) -> void:
	var s = settings.sync
	if s == null or _sync_busy or in_battle:
		return
	_sync_busy = true
	var r = await _http(HTTPClient.METHOD_PUT, http_base(s.server) + "/api/sync/" + s.code,
		JSON.stringify({"save": _sync_blob(), "base": s.base, "device": "desktop"}))
	if settings.sync == s:
		if r.code == 409:
			adopt_save(r.body.save)
			s.base = r.body.updatedAt
			toast.emit("☁️ Loaded newer progress from your other device")
		elif r.code == 200:
			s.base = r.body.updatedAt
		if r.code == 200 or r.code == 409:
			s.at = CC.now_ms()
			s.err = null
		else:
			s.err = r.body.error if typeof(r.body) == TYPE_DICTIONARY and r.body.has("error") else ("HTTP %d" % r.code if r.code else "offline")
			if not quiet:
				toast.emit("Sync failed: " + str(s.err))
		save_settings()
		changed.emit()
	_sync_busy = false

func sync_create(server: String) -> void:
	var bytes = Crypto.new().generate_random_bytes(10)
	var code = ""
	for b in bytes:
		code += CODE_CHARS[b % 32]
	settings.sync = {"server": server, "code": code, "base": 0, "at": null, "err": null}
	await sync_now()
	if settings.sync and settings.sync.err != null:
		settings.sync = null
	elif settings.sync:
		toast.emit("☁️ Sync code created: " + code)
	save_settings()
	changed.emit()

func sync_link(server: String, code: String) -> void:
	code = code.strip_edges().to_upper()
	var r = await _http(HTTPClient.METHOD_GET, http_base(server) + "/api/sync/" + code)
	if r.code != 200:
		toast.emit(r.body.error if typeof(r.body) == TYPE_DICTIONARY and r.body.has("error") else "Could not reach the sync server")
		return
	adopt_save(r.body.save)
	settings.sync = {"server": server, "code": code, "base": r.body.updatedAt, "at": CC.now_ms(), "err": null}
	save_settings()
	toast.emit("☁️ Linked! This computer now syncs.")
	changed.emit()

func sync_off() -> void:
	settings.sync = null
	save_settings()
	changed.emit()
