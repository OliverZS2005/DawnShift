# Prints rule calculations for a fixed tycoon, and the window layout of a few city buildings, so they
# can be diffed against shared.js and models.js (see parity.js).
extends SceneTree
func _init():
	var CCs = load("res://rules.gd").new()
	var out = []
	for lvl in [1, 3, 7]:
		var t = CCs.new_tycoon()
		t.level = lvl
		t.prestige = 2 if lvl == 7 else 0
		t.perks = {"income": 3, "cash": 1}
		t.money = 5e12
		t.buildings = {"lemon": {"count": 30, "level": 2}, "bank": {"count": 5, "level": 0}}
		t.weapons["smg"] = {"dmg": 3, "rate": 1, "mag": 0, "armor": 2}
		var row = [CCs.income(t), CCs.reboot_cost(t), CCs.prestige_points(t), CCs.b_cost(t, CCs.BUILDINGS[0]), CCs.b_up_cost(t, CCs.BUILDINGS[4]), CCs.up_cost(t, CCs.weapon("smg"), "dmg"), CCs.offline_earnings(t, 99999), CCs.match_distance(t, {"money": 1234.0, "level": 2, "prestige": 0})]
		CCs.apply_action(t, {"type": "reboot"})
		row.append_array([t.level, t.money, t.points])
		out.append(row)
	# the window layout ported from models.js windowsOf() (see parity.js)
	var R = load("res://r3d.gd").new()
	R._ready()
	var wins = []
	var near = R.M.LAYOUT.arena.buildings.filter(func(b): return b.near)
	for b in near.slice(0, 4):
		for w in R.windows_of(b, true):
			wins.append_array(w)
	out.append(wins)
	R.free()
	print("PARITY " + JSON.stringify(out))
	quit()
