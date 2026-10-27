# End-to-end test of the desktop app, run together with a browser test (see ../../README.md):
#   godot --headless --path cashclash/desktop res://tests/e2e.tscn -- <server> <exchange dir>
# The exchange dir is how this test and the browser test hand each other sync codes / signals.
extends Node

var server := ""
var dir := ""
var fails := 0

func check(ok: bool, what: String) -> void:
	print(("PASS " if ok else "FAIL ") + what)
	if not ok: fails += 1

func wait_file(name: String, sec := 60.0) -> String:
	var t = 0.0
	while t < sec:
		if FileAccess.file_exists(dir + "/" + name):
			return FileAccess.open(dir + "/" + name, FileAccess.READ).get_as_text().strip_edges()
		await get_tree().create_timer(0.25).timeout
		t += 0.25
	return ""

func put_file(name: String, text: String) -> void:
	FileAccess.open(dir + "/" + name, FileAccess.WRITE).store_string(text)

func _ready() -> void:
	var args = OS.get_cmdline_user_args()
	server = args[0]
	dir = args[1]
	var main = load("res://main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame

	# 1. Every screen renders in both states (fresh, and maxed-out level 7 with perks).
	for t in ["play", "tycoon", "armory", "battle", "reboot"]:
		main.tab = t
		main.render()
	Game.sp.tycoon.level = 7
	Game.sp.tycoon.points = 5
	Game.sp.tycoon.money = 1e13
	Game.act({"type": "perk", "id": "hp"})
	Game.act({"type": "buy", "id": "dyson"})
	for t in ["tycoon", "reboot", "battle"]:
		main.tab = t
		main.render()
	check(CC.perk(Game.sp.tycoon, "hp") == 1 and CC.owned(Game.sp.tycoon, "dyson") == 1, "level 7 perk + Dyson Sphere purchase")

	# 2. A singleplayer fight resolves (bot plays both sides, simulated fast).
	var A = CC.new_arena(Game.sp.tycoon, CC.rival_loadout(Game.sp.rivals[0]))
	var w = -1
	var steps = 0
	while w < 0 and steps < 60 * 300:
		w = CC.step_arena(A, [CC.bot_input(A, 0, 0.9), CC.bot_input(A, 1, 0.9)], 1.0 / 60.0)
		steps += 1
	check(w >= 0, "bot-vs-bot fight finished in %.0fs on %s" % [A.t, CC.MAPS[A.map].name])

	# 3. Rivals level up over time.
	var r = {"name": "T", "money": 30000.0, "skill": 0.9, "level": 1, "prestige": 0}
	check(CC.tick_rival(r, 1.0) != "" and r.level == 2, "rival reboots to level 2")

	# 4. Sync desktop -> web: create a code, the browser links to it and must see this money.
	Game.sp.tycoon.money = 123456.0
	Game.sp.tycoon.level = 3
	await Game.sync_create(server)
	check(Game.settings.sync != null, "sync code created")
	put_file("code", Game.settings.sync.code)
	# 5. Sync web -> desktop: the browser changes money and pushes; we must pick it up.
	check(await wait_file("web_pushed") == "ok", "browser pushed its save")
	await Game.sync_now()
	check(int(Game.sp.tycoon.money) == 777777, "desktop loaded web progress (money=%s)" % Game.sp.tycoon.money)

	# 6. Cross-play: import into a server and fight the browser player.
	Game.settings.name = "Desk"
	Game.connect_server(server, "import")
	var t2 = 0.0
	while Game.mode != "mp" and t2 < 10:
		await get_tree().create_timer(0.2).timeout
		t2 += 0.2
	check(Game.mode == "mp" and int(Game.net.state.tycoon.level) == 3, "joined server with imported level-3 tycoon")
	var result = []
	Game.battle_result.connect(func(won, text): result.append(text))
	Game.send({"type": "queue"})
	put_file("desk_queued", "ok")
	t2 = 0.0
	while result.is_empty() and t2 < 90:
		await get_tree().create_timer(0.5).timeout
		t2 += 0.5
	check(not result.is_empty(), "online fight vs web player finished: " + (result[0] if result.size() else "timeout"))
	print("DONE fails=%d" % fails)
	get_tree().quit(1 if fails else 0)
