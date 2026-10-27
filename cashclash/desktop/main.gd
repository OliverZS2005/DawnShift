# Desktop UI. Built in code and laid out like the web version: Play, Tycoon, Armory, Battle, Reboot.
extends Control

const C_BG = Color("#12141a")
const C_PANEL = Color("#1b1f29")
const C_PANEL2 = Color("#232836")
const C_LINE = Color("#2e3446")
const C_TEXT = Color("#e8ebf2")
const C_MUTED = Color("#8a93a8")
const C_GOLD = Color("#f5c542")
const C_GREEN = Color("#4ade80")
const C_RED = Color("#f87171")
const C_BLUE = Color("#60a5fa")

const TABS = [["play", "🎮 Play"], ["tycoon", "🏭 Tycoon"], ["armory", "🔫 Armory"], ["battle", "⚔️ Battle"], ["reboot", "🔄 Reboot"]]

var tab := "play"
var content: VBoxContainer
var money_lbl: Label
var rate_lbl: Label
var mode_lbl: Label
var tab_btns := {}
var toast_panel: PanelContainer
var toast_lbl: Label
var toast_left := 0.0
var confirm_dlg: ConfirmationDialog
var confirm_cb: Callable
var arena
var city
var rerender_acc := 0.0
var dirty := true
var queue_lbl: Label

func _ready() -> void:
	theme = _make_theme()
	var bg = ColorRect.new()
	bg.color = C_BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var root = VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)

	var header = PanelContainer.new()
	header.add_theme_stylebox_override("panel", _box(C_BG, C_LINE, 0, 12, Vector4(0, 0, 0, 1)))
	root.add_child(header)
	var hb = HBoxContainer.new()
	hb.add_theme_constant_override("separation", 16)
	header.add_child(hb)
	hb.add_child(_label("💰 Cash Clash", 22, C_TEXT))
	var mv = VBoxContainer.new()
	mv.add_theme_constant_override("separation", 0)
	money_lbl = _label("$0", 22, C_GOLD)
	rate_lbl = _label("+$0/s", 14, C_GREEN)
	mv.add_child(money_lbl)
	mv.add_child(rate_lbl)
	hb.add_child(mv)
	mode_lbl = _label("", 13, C_MUTED)
	mode_lbl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	hb.add_child(mode_lbl)
	var spacer = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hb.add_child(spacer)
	for t in TABS:
		var b = _button(t[1], func(): tab = t[0]; render())
		b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		tab_btns[t[0]] = b
		hb.add_child(b)

	# The 3D city sits above the Tycoon tab's cards and stays alive between re-renders.
	city = preload("res://city3d.gd").new()
	city.custom_minimum_size.y = 320
	city.visible = false
	city.lot_clicked.connect(func(i): Game.act({"type": "buy", "id": CC.BUILDINGS[i].id}); render())
	city.crate_clicked.connect(func(): Game.act({"type": "claim"}); render())
	root.add_child(city)

	var scroll = ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	root.add_child(scroll)
	var margin = MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 16)
	scroll.add_child(margin)
	content = VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 12)
	margin.add_child(content)

	arena = preload("res://arena.gd").new()
	arena.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	arena.visible = false
	arena.closed.connect(func(): render())
	add_child(arena)

	toast_panel = PanelContainer.new()
	toast_panel.add_theme_stylebox_override("panel", _box(C_PANEL2, C_GOLD, 10, 12))
	toast_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	toast_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	toast_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	toast_panel.position.y -= 20
	toast_lbl = _label("", 14, C_TEXT)
	toast_panel.add_child(toast_lbl)
	toast_panel.visible = false
	add_child(toast_panel)

	confirm_dlg = ConfirmationDialog.new()
	confirm_dlg.confirmed.connect(func(): confirm_cb.call())
	add_child(confirm_dlg)

	Game.changed.connect(func(): dirty = true)
	Game.toast.connect(show_toast)
	Game.news.connect(func(m): if tab == "battle": show_toast(m))
	Game.match_started.connect(func(info): arena.open(info))
	get_viewport().size_changed.connect(func(): dirty = true)
	render()

func _process(dt: float) -> void:
	var t = Game.tycoon()
	money_lbl.text = CC.fmt(t.money)
	rate_lbl.text = "+%s/s" % CC.fmt(CC.income(t))
	if toast_left > 0:
		toast_left -= dt
		if toast_left <= 0:
			toast_panel.visible = false
	if queue_lbl and is_instance_valid(queue_lbl):
		queue_lbl.text = Game.net.get("queue_text", "") if Game.mode == "mp" else Game.sp_queue_status()
	city.visible = tab == "tycoon" and not arena.visible
	if city.visible:
		city.custom_minimum_size.y = max(260.0, size.y * 0.42)
		city.update_city(t)
	# The Play tab has text fields, so it only re-renders when something actually changes.
	rerender_acc += dt
	if arena.visible:
		return
	if dirty or (rerender_acc > 1.0 and tab in ["tycoon", "armory", "reboot"]):
		rerender_acc = 0.0
		render()

func show_toast(msg: String) -> void:
	toast_lbl.text = msg
	toast_panel.visible = true
	toast_panel.reset_size()
	toast_panel.position.x = (size.x - toast_panel.size.x) / 2
	toast_panel.position.y = size.y - toast_panel.size.y - 20
	toast_left = 3.0

func ask(text: String, cb: Callable) -> void:
	confirm_dlg.dialog_text = text
	confirm_cb = cb
	confirm_dlg.popup_centered()

# ---------- Widgets ----------
func _make_theme() -> Theme:
	var th = Theme.new()
	var f = SystemFont.new()
	f.font_names = PackedStringArray(["Segoe UI", "Helvetica Neue", "Noto Sans", "DejaVu Sans", "Arial"])
	var emoji = SystemFont.new()
	emoji.font_names = PackedStringArray(["Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"])
	f.fallbacks = [emoji]
	th.default_font = f
	th.default_font_size = 14
	th.set_color("font_color", "Label", C_TEXT)
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		var col = C_PANEL2
		var border = C_GOLD if st == "hover" else C_LINE
		th.set_stylebox(st, "Button", _box(col, border, 8, 8))
	th.set_color("font_color", "Button", C_TEXT)
	th.set_color("font_hover_color", "Button", C_TEXT)
	th.set_color("font_disabled_color", "Button", Color(C_TEXT, 0.35))
	th.set_stylebox("normal", "LineEdit", _box(C_PANEL2, C_LINE, 8, 8))
	th.set_stylebox("focus", "LineEdit", _box(C_PANEL2, C_GOLD, 8, 8))
	return th

func _box(bg: Color, border: Color, radius: int, pad: int, borders := Vector4(1, 1, 1, 1)) -> StyleBoxFlat:
	var s = StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.border_width_left = int(borders.x); s.border_width_top = int(borders.y)
	s.border_width_right = int(borders.z); s.border_width_bottom = int(borders.w)
	s.set_corner_radius_all(radius)
	s.set_content_margin_all(pad)
	return s

func _label(text: String, size := 14, color := C_TEXT, wrap := false) -> Label:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size.x = 200
	return l

func _button(text: String, cb: Callable, disabled := false, primary := false, danger := false) -> Button:
	var b = Button.new()
	b.text = text
	b.disabled = disabled
	b.focus_mode = Control.FOCUS_NONE
	if primary:
		b.add_theme_stylebox_override("normal", _box(C_GOLD, C_GOLD, 8, 8))
		b.add_theme_stylebox_override("hover", _box(C_GOLD.lightened(0.15), C_GOLD, 8, 8))
		b.add_theme_stylebox_override("disabled", _box(Color(C_GOLD, 0.35), C_GOLD, 8, 8))
		b.add_theme_color_override("font_color", Color("#111111"))
		b.add_theme_color_override("font_hover_color", Color("#111111"))
	if danger:
		b.add_theme_color_override("font_color", C_RED)
	b.pressed.connect(cb)
	return b

func _card(parent: Control, title: String, highlight := false) -> VBoxContainer:
	var p = PanelContainer.new()
	p.add_theme_stylebox_override("panel", _box(C_PANEL, C_GOLD if highlight else C_LINE, 12, 14))
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(p)
	var v = VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	p.add_child(v)
	if title != "":
		v.add_child(_label(title, 16))
	return v

func _row(parent: Control) -> HBoxContainer:
	var r = HBoxContainer.new()
	r.add_theme_constant_override("separation", 8)
	parent.add_child(r)
	return r

func _spacer(parent: Control) -> void:
	var s = Control.new()
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(s)

func _grid(parent: Control) -> GridContainer:
	var g = GridContainer.new()
	g.columns = max(1, int((size.x - 32) / 330))
	g.add_theme_constant_override("h_separation", 12)
	g.add_theme_constant_override("v_separation", 12)
	g.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(g)
	return g

func _input_field(parent: Control, label: String, value: String, placeholder := "") -> LineEdit:
	parent.add_child(_label(label, 13, C_MUTED))
	var e = LineEdit.new()
	e.text = value
	e.placeholder_text = placeholder
	parent.add_child(e)
	return e

# ---------- Screens ----------
func render() -> void:
	dirty = false
	queue_lbl = null
	for t in tab_btns:
		var active = t == tab
		tab_btns[t].add_theme_stylebox_override("normal", _box(C_GOLD if active else C_PANEL, C_LINE, 8, 8))
		tab_btns[t].add_theme_color_override("font_color", Color("#111111") if active else C_TEXT)
	mode_lbl.text = ("🌐 " + str(Game.net.get("server", "Multiplayer"))) if Game.mode == "mp" else "💻 Singleplayer"
	mode_lbl.add_theme_color_override("font_color", C_BLUE if Game.mode == "mp" else C_MUTED)
	for c in content.get_children():
		content.remove_child(c)
		c.queue_free()
	match tab:
		"play": _render_play()
		"tycoon": _render_tycoon()
		"armory": _render_armory()
		"battle": _render_battle()
		"reboot": _render_reboot()

func _render_play() -> void:
	var t = Game.sp.tycoon
	var g = _grid(content)
	var c = _card(g, "💻 Singleplayer", Game.mode == "sp")
	c.add_child(_label("Runs entirely on your PC. Fight computer rivals. You have one singleplayer game — you can reset it, but not make another.", 13, C_MUTED, true))
	c.add_child(_label("%s · %s/s · %dW / %dL · L%d %s" % [CC.fmt(t.money), CC.fmt(CC.income(t)), Game.sp.wins, Game.sp.losses, t.level, CC.LEVELS[t.level - 1]]))
	var r = _row(c)
	r.add_child(_button("Playing" if Game.mode == "sp" else "Play singleplayer", func(): Game.mode = "sp"; render(), Game.mode == "sp", true))
	r.add_child(_button("Reset singleplayer game", func(): ask("Reset your whole singleplayer game? Money, buildings, weapons, levels and perks will be wiped. This cannot be undone.", Game.reset_sp), false, false, true))

	c = _card(g, "🌐 Multiplayer", Game.mode == "mp")
	if Game.net.has("state") and Game.net.state != null:
		c.add_child(_label("Connected to %s as %s · %d online" % [Game.net.server, Game.net.state.name, int(Game.net.get("online", 1))], 14, C_TEXT, true))
		r = _row(c)
		r.add_child(_button("Playing" if Game.mode == "mp" else "Resume multiplayer", func(): Game.mode = "mp"; render(), Game.mode == "mp"))
		r.add_child(_button("Disconnect", Game.disconnect_server))
	else:
		c.add_child(_label("Battle real players. Join any Cash Clash server — anyone can host one.", 13, C_MUTED, true))
		var srv = _input_field(c, "Server address", Game.settings.server)
		var nm = _input_field(c, "Your name", Game.settings.name, "Player")
		r = _row(c)
		r.add_child(_label("Connecting…" if Game.net.get("connecting") else "", 13, C_MUTED))
		_spacer(r)
		r.add_child(_button("Join server", func():
			Game.settings.server = srv.text
			Game.settings.name = nm.text.strip_edges()
			Game.save_settings()
			Game.connect_server(srv.text), false, true))

	if Game.pending_choice != "":
		c = _card(content, "Joining " + Game.pending_choice, true)
		c.add_child(_label("You don't have a profile on this server yet. How do you want to start?", 13, C_MUTED, true))
		var nb = 0
		for b in CC.BUILDINGS:
			nb += CC.owned(t, b.id)
		r = _row(c)
		var b1 = _button("🆕 New multiplayer tycoon\nStart from $50 with a pistol, only on this server.", func(): Game.connect_server(Game.pending_choice, "new"))
		var b2 = _button("📦 Import my singleplayer tycoon\nCopy %s, %d buildings, %d weapons. Singleplayer keeps its copy." % [CC.fmt(t.money), nb, t.weapons.size()], func(): Game.connect_server(Game.pending_choice, "import"))
		for b in [b1, b2]:
			b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			r.add_child(b)
		r = _row(c)
		_spacer(r)
		r.add_child(_button("Cancel", func(): Game.pending_choice = ""; render()))

	c = _card(content, "☁️ Sync with the web version")
	var s = Game.settings.sync
	if s != null:
		c.add_child(_label("Sync code  %s  on %s" % [s.code, s.server], 16, C_GOLD))
		var st = "Last synced %s." % Time.get_time_string_from_unix_time(int(s.at / 1000.0)) if s.get("at") else ""
		if s.get("err") != null:
			st = "Last sync failed: %s" % s.err
		c.add_child(_label("Enter this code in the web version (Play tab → Sync) to share your singleplayer game and multiplayer logins. %s Play on one device at a time." % st, 13, C_MUTED, true))
		r = _row(c)
		r.add_child(_button("Sync now", func(): Game.sync_now()))
		r.add_child(_button("Stop syncing", Game.sync_off, false, false, true))
	else:
		c.add_child(_label("Keep this app and the web version in sync through a Cash Clash server. Create a code here, or enter the code shown in the web version.", 13, C_MUTED, true))
		var ss = _input_field(c, "Sync server", Game.settings.server)
		var code = _input_field(c, "Sync code (to link an existing one)", "", "e.g. K7Q2M9XPLR")
		r = _row(c)
		r.add_child(_button("Create new sync code", func(): Game.sync_create(ss.text), false, true))
		r.add_child(_button("Link with code", func(): ask("Replace the singleplayer game on this computer with the synced one?", func(): Game.sync_link(ss.text, code.text))))

func _render_tycoon() -> void:
	var t = Game.tycoon()
	if t.event != null and t.event.until > CC.now_ms():
		var e = CC.EVENTS[t.event.type]
		var bc = _card(content, "", true)
		var r = _row(bc)
		r.add_child(_label("%s %s — %s (%ds)" % [e.icon, e.name, e.desc, ceil((t.event.until - CC.now_ms()) / 1000.0)]))
		_spacer(r)
		if t.event.type == "crate":
			r.add_child(_button("Claim " + CC.fmt(max(100.0, CC.income(t) * 90.0)), func(): Game.act({"type": "claim"}), false, true))
	content.add_child(_label("%s · income x%.2f · Owning 25/50/100/200 of a building doubles its output each time." % [CC.LEVELS[t.level - 1], CC.global_mult(t)], 13, C_MUTED, true))
	var g = _grid(content)
	for b in CC.BUILDINGS:
		if not CC.unlocked(t, b):
			var lc = _card(g, "🔒 %s %s" % [b.icon, b.name])
			lc.modulate.a = 0.55
			lc.add_child(_label("Unlocks at business level %d: %s. Reboot to get there." % [b.unlock, CC.LEVELS[b.unlock - 1]], 13, C_MUTED, true))
			continue
		var n = CC.owned(t, b.id)
		var c = _card(g, "%s %s   x%d   Lv %d" % [b.icon, b.name, n, CC.b_level(t, b.id)])
		var nm = CC.next_milestone(n)
		c.add_child(_label("Total %s/s · %s" % [CC.fmt(CC.b_income(t, b)), ("next x2 at %d owned" % nm) if nm != null else "all milestones!"], 13, C_MUTED))
		var r = _row(c)
		var id = b.id
		r.add_child(_button("Buy · " + CC.fmt(CC.b_cost(t, b)), func(): Game.act({"type": "buy", "id": id}), t.money < CC.b_cost(t, b)))
		r.add_child(_button("Upgrade x2 · " + CC.fmt(CC.b_up_cost(t, b)), func(): Game.act({"type": "bup", "id": id}), n == 0 or t.money < CC.b_up_cost(t, b)))

func _render_armory() -> void:
	var t = Game.tycoon()
	content.add_child(_label("Buy weapons and upgrade them. You bring your equipped weapon into battle and can switch to any other owned weapon with keys 1-5.", 13, C_MUTED, true))
	var g = _grid(content)
	for w in CC.WEAPONS:
		var c = _card(g, "%s %s" % [w.icon, w.name], t.equipped == w.id)
		c.add_child(_label("%d dmg/shot · %s/s · mag %d%s" % [w.dmg * w.pellets, str(w.rate), w.mag, " · splash" if w.splash > 0 else ""], 13, C_MUTED))
		var id = w.id
		if t.weapons.has(w.id):
			for st in CC.STATS:
				var r = _row(c)
				var lv = int(t.weapons[w.id][st])
				r.add_child(_label("%s  %d/%d" % [CC.STATS[st], lv, CC.MAX_LVL]))
				_spacer(r)
				var stat = st
				var maxed = lv >= CC.MAX_LVL
				r.add_child(_button("MAX" if maxed else CC.fmt(CC.up_cost(t, w, st)), func(): Game.act({"type": "wup", "id": id, "stat": stat}), maxed or t.money < CC.up_cost(t, w, st)))
			var r2 = _row(c)
			_spacer(r2)
			r2.add_child(_button("Equipped" if t.equipped == w.id else "Equip", func(): Game.act({"type": "equip", "id": id}), t.equipped == w.id))
		else:
			var r3 = _row(c)
			_spacer(r3)
			r3.add_child(_button("Buy · " + CC.fmt(w.price), func(): Game.act({"type": "wbuy", "id": id}), t.money < w.price, true))

func _lvl(e) -> String:
	var s = "L%d" % int(e.get("level", 1))
	if int(e.get("prestige", 0)) > 0:
		s += "★%d" % int(e.prestige)
	return s

func _board(parent: Control, rows: Array) -> void:
	var g = GridContainer.new()
	g.columns = 4
	g.add_theme_constant_override("h_separation", 16)
	parent.add_child(g)
	for i in rows.size():
		var e = rows[i]
		var col = C_GOLD if e.get("you", false) else C_TEXT
		g.add_child(_label("#%d" % (i + 1), 14, col))
		g.add_child(_label(("🟢 " if e.get("online", false) else "") + str(e.name), 14, col))
		g.add_child(_label(_lvl(e), 13, C_BLUE))
		g.add_child(_label(CC.fmt(e.money) + (("   %dW/%dL" % [e.wins, e.losses]) if e.has("wins") else ""), 14, col))

func _render_battle() -> void:
	var g = _grid(content)
	if Game.mode == "mp":
		var s = Game.net.state
		var c = _card(g, "⚔️ Find a match · online · %d players" % int(Game.net.get("online", 1)))
		c.add_child(_label("Matched with the queued player closest to your wealth and level; the range widens the longer you wait. Win: take 10% of their money. Lose: they take 10% of yours.", 13, C_MUTED, true))
		c.add_child(_label("Record: %dW / %dL" % [s.wins, s.losses]))
		if Game.net.queue == "searching":
			c.add_child(_button("Cancel search", func(): Game.send({"type": "cancel"}); Game.net.queue = "idle"; render()))
		else:
			c.add_child(_button("Search for opponent", func(): Game.send({"type": "queue"}); Game.net.queue = "searching"; render(), false, true))
		queue_lbl = _label("", 13, C_MUTED, true)
		c.add_child(queue_lbl)
		var lb = _card(g, "🏆 Server leaderboard")
		var rows = []
		for e in Game.net.board:
			var x = e.duplicate()
			x.you = e.id == Game.net.get("you")
			rows.append(x)
		_board(lb, rows)
	else:
		var t = Game.sp.tycoon
		var w = CC.weapon(t.equipped)
		var c = _card(g, "⚔️ Find a match · vs computer")
		c.add_child(_label("Matchmaking finds the rival closest to your money and business level. Rivals reboot and level up too. Win: take 10% of their money. Lose: they take 10% of yours.", 13, C_MUTED, true))
		c.add_child(_label("Record: %dW / %dL · %s %s" % [Game.sp.wins, Game.sp.losses, w.icon, w.name]))
		c.add_child(_button("Search for opponent", Game.queue_sp, Game.sp_queue >= 0, true))
		queue_lbl = _label("", 13, C_MUTED, true)
		c.add_child(queue_lbl)
		c.add_child(_label("Battle log", 16))
		var logs = Game.sp.log.slice(-12)
		logs.reverse()
		for l in logs:
			c.add_child(_label(l.t, 13, C_GREEN if l.w else C_RED))
		var lb = _card(g, "🏆 Leaderboard")
		var rows = Game.sp.rivals.duplicate()
		rows.append({"name": "YOU", "money": t.money, "level": t.level, "prestige": t.prestige, "you": true})
		rows.sort_custom(func(a, b): return a.money > b.money)
		_board(lb, rows)

func _render_reboot() -> void:
	var t = Game.tycoon()
	var cost = CC.reboot_cost(t)
	var top = int(t.level) >= CC.MAX_BIZ
	var g = _grid(content)
	var c = _card(g, "🔄 Prestige reboot" if top else "🔄 Reboot to the next business level", true)
	c.add_child(_label("Current level: %d/%d · %s%s" % [t.level, CC.MAX_BIZ, CC.LEVELS[t.level - 1], (" · Prestige %d" % t.prestige) if t.prestige else ""], 14, C_BLUE))
	var unlocks = []
	for b in CC.BUILDINGS:
		if b.unlock == int(t.level) + 1:
			unlocks.append(b.icon + " " + b.name)
	var desc = "Rebooting wipes your money, buildings and weapons. "
	if top:
		desc += "At the top level, each reboot gives Boost Points (more if you overshoot the goal). You'd get %d right now." % CC.prestige_points(t)
	else:
		desc += "You'll reach %s: income x2 forever%s." % [CC.LEVELS[t.level], (", and you unlock " + ", ".join(unlocks)) if unlocks.size() else ""]
	c.add_child(_label(desc, 13, C_MUTED, true))
	var bar = ProgressBar.new()
	bar.max_value = 100
	bar.value = min(100.0, t.money / cost * 100.0)
	bar.show_percentage = false
	bar.custom_minimum_size.y = 8
	bar.add_theme_stylebox_override("background", _box(C_PANEL2, C_PANEL2, 4, 0))
	bar.add_theme_stylebox_override("fill", _box(C_GOLD, C_GOLD, 4, 0))
	c.add_child(bar)
	var r = _row(c)
	r.add_child(_label("%s / %s" % [CC.fmt(t.money), CC.fmt(cost)]))
	_spacer(r)
	var q = ("Prestige for %d Boost Points?" % CC.prestige_points(t)) if top else ("Reboot to %s?" % CC.LEVELS[min(t.level, CC.MAX_BIZ - 1)])
	r.add_child(_button("Prestige!" if top else "Reboot", func(): ask(q + " You lose all money, buildings and weapons.", func(): Game.act({"type": "reboot"}); show_toast("🔄 Rebooted!")), t.money < cost, true))

	var lc = _card(g, "📈 Levels")
	for i in CC.MAX_BIZ:
		lc.add_child(_label("%s  %s   x%d income" % ["✅" if i + 1 <= int(t.level) else "🔒", CC.LEVELS[i], int(pow(2, i))], 14, C_GOLD if i + 1 == int(t.level) else C_TEXT))

	var pc = _card(content, "⭐ Boost Points: %d" % int(t.points))
	pc.add_child(_label("Spend points on permanent perks. They survive every reboot and work in battle too." if top else "Reach level %d (%s) to earn Boost Points." % [CC.MAX_BIZ, CC.LEVELS[CC.MAX_BIZ - 1]], 13, C_MUTED, true))
	var pg = _grid(pc)
	for k in CC.PERKS:
		var p = CC.PERKS[k]
		var lv = CC.perk(t, k)
		var kc = _card(pg, "%s %s  %d/%d" % [p.icon, p.name, lv, p.max])
		kc.add_child(_label(p.desc + " per level", 13, C_MUTED))
		var kr = _row(kc)
		_spacer(kr)
		var id = k
		kr.add_child(_button("MAX" if lv >= p.max else "%d pt" % CC.perk_cost(t, k), func(): Game.act({"type": "perk", "id": id}), lv >= p.max or int(t.points) < CC.perk_cost(t, k)))
