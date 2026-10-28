# Prints rule calculations for a fixed tycoon so they can be diffed against shared.js (see parity.js).
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
		# what the reboot still asks for, then everything done but the cash, then all of it
		row.append(CCs.apply_action(t, {"type": "reboot"}))
		for g in CCs.reboot_goals(t):
			row.append_array([g.id, g.have, g.need])
		CCs.record_win(t)
		t.quest.run.jobs = 99
		row.append(CCs.reboot_blocker(t))
		t.quest.run.wins = 99
		for id in ["lemon", "cafe", "bank"]:
			t.buildings[id] = {"count": 200, "level": 0}
		t.weapons.pistol = {"dmg": 10, "rate": 10, "mag": 10, "armor": 10}
		row.append(CCs.reboot_blocker(t))
		t.money = 1.0
		row.append(CCs.reboot_blocker(t))
		t.money = 5e12
		row.append(CCs.apply_action(t, {"type": "reboot"}))
		row.append_array([t.level, t.money, t.points, t.quest.run.wins])
		out.append(row)
	print("PARITY " + JSON.stringify(out))
	# quests: who's in each area, what they say and ask, and a job taken, done and handed in
	var words = []
	for setup in [[1, 0], [4, 0], [7, 3]]:
		var t = CCs.new_tycoon()
		t.level = setup[0]
		t.prestige = setup[1]
		t.money = 1234.5 * pow(10, setup[0])
		for b in CCs.BUILDINGS:
			if CCs.unlocked(t, b):
				t.buildings[b.id] = {"count": 7 + b.unlock, "level": 1}
		for area in CCs.quest_areas():
			if area != "plaza" and not t.buildings.has(area):
				continue
			for step in 4:
				var k = CCs.quest_talk(t, area)
				words.append([area, k.name, k.role, k.mood, k.hi, k.why, k.ask, k.take, k.done, k.reward, k.points])
				CCs.apply_action(t, {"type": "quest", "area": area, "op": "accept"})
				var p = CCs.quest_progress(t, area)
				words.append([area, p[0], p[1]])
				CCs.apply_action(t, {"type": "quest", "area": area, "op": "drop" if step % 2 else "claim"})
				CCs.record_win(t)
	print("QUESTS " + JSON.stringify(words))
	# money formatting, ties included
	var money = []
	for i in 400:
		money.append(CCs.fmt(floor(pow(1.37, i % 90) * (1 + i * 7919 % 1000))))
	for v in [15625000.0, 15635000.0, 1125.0, 2375.0, 9875.0, 160845.0, 541505.0]:
		money.append(CCs.fmt(v))
	print("FMT " + JSON.stringify(money))
	quit()
