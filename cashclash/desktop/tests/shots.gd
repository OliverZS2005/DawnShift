# Screenshots of the desktop app's 3D views (needs a display, e.g. xvfb-run):
#   godot --path cashclash/desktop res://tests/shots.tscn -- <output dir>
# Without a graphics card, Mesa's software Vulkan driver (lavapipe, package mesa-vulkan-drivers) works.
extends Node

func _ready() -> void:
	var out = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() else "/tmp"
	var main = load("res://main.tscn").instantiate()
	add_child(main)
	var t = Game.sp.tycoon
	t.level = 4
	t.money = 5e7
	t.buildings = {"lemon": {"count": 60, "level": 2}, "cafe": {"count": 30, "level": 1}, "arcade": {"count": 12, "level": 0}, "fact": {"count": 5, "level": 0}, "bank": {"count": 2, "level": 0}}
	main.tab = "tycoon"
	main.render()
	await _wait(90)
	_save(out + "/g_city.png")
	t.level = 7
	t.buildings.oil = {"count": 3, "level": 0}; t.buildings.space = {"count": 1, "level": 0}
	t.buildings.ailab = {"count": 1, "level": 0}; t.buildings.dyson = {"count": 1, "level": 0}
	await _wait(90)
	_save(out + "/g_city7.png")
	for m in 4:
		var w = ["smg", "sniper", "shotgun", "rocket"][m]
		t.weapons[w] = {"dmg": 0, "rate": 0, "mag": 0, "armor": 0}
		t.equipped = w
		var r = Game.sp.rivals[5]
		Game.in_battle = true
		Game.match_started.emit({"mp": false, "rival": r, "opp_name": r.name, "you": 0, "pot": {"win": r.money * 0.1, "lose": t.money * 0.1}})
		main.arena.A = CC.new_arena(t, CC.rival_loadout(r), m)
		main.arena.A.units[0].x = 300; main.arena.A.units[0].y = 440
		main.arena.A.units[1].x = 520; main.arena.A.units[1].y = 330
		# first person: face the opponent (slightly off so the tag and gun are both in view) and fire
		main.arena.yaw = atan2(330 - 440, 520 - 300) - 0.08
		main.arena.pitch = -0.04
		main.arena.force_shoot = m != 1
		await _wait(80)
		main.arena.force_shoot = false
		_save(out + "/g_fight%d.png" % m)
		main.arena.visible = false
		Game.in_battle = false
	# close-up of the opponent (held in place) to check the fighter and the gun in his hand
	var rv = Game.sp.rivals[5]
	Game.in_battle = true
	Game.match_started.emit({"mp": false, "rival": rv, "opp_name": rv.name, "you": 0, "pot": {"win": rv.money * 0.1, "lose": t.money * 0.1}})
	main.arena.A = CC.new_arena(t, CC.rival_loadout(rv), 0)
	for i in 60:
		var u = main.arena.A.units
		u[0].x = 300; u[0].y = 400; u[1].x = 360; u[1].y = 420
		main.arena.yaw = atan2(20, 60) + 0.15
		main.arena.pitch = 0.05
		await get_tree().process_frame
	_save(out + "/g_char.png")
	get_tree().quit()

func _wait(frames: int) -> void:
	for i in frames:
		await get_tree().process_frame

func _save(path: String) -> void:
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
