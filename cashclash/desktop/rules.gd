# Game rules: a GDScript port of ../shared.js. Keep the two in step — the desktop app
# shares saves with the web version and plays on the same multiplayer servers.
extends Node

const BUILDINGS = [
	{"id": "lemon",  "name": "Lemonade Stand", "icon": "🍋", "base": 10.0,    "income": 0.5,     "unlock": 1},
	{"id": "cafe",   "name": "Coffee Shop",    "icon": "☕", "base": 400.0,   "income": 4.0,     "unlock": 1},
	{"id": "arcade", "name": "Arcade",         "icon": "🕹️", "base": 6000.0,  "income": 30.0,    "unlock": 1},
	{"id": "fact",   "name": "Factory",        "icon": "🏭", "base": 90000.0, "income": 220.0,   "unlock": 2},
	{"id": "bank",   "name": "Bank",           "icon": "🏦", "base": 1.4e6,   "income": 1700.0,  "unlock": 3},
	{"id": "oil",    "name": "Oil Rig",        "icon": "🛢️", "base": 2.2e7,   "income": 13000.0, "unlock": 4},
	{"id": "space",  "name": "Space Mine",     "icon": "🚀", "base": 3.5e8,   "income": 1e5,     "unlock": 5},
	{"id": "ailab",  "name": "AI Lab",         "icon": "🧠", "base": 5.5e9,   "income": 8e5,     "unlock": 6},
	{"id": "dyson",  "name": "Dyson Sphere",   "icon": "☀️", "base": 9e10,    "income": 6.5e6,   "unlock": 7},
]
const WEAPONS = [
	{"id": "pistol",  "name": "Pistol",          "icon": "🔫", "price": 0.0,      "dmg": 14.0, "rate": 3.0,  "mag": 12, "reload": 1.1, "speed": 700.0,  "spread": 0.03,  "pellets": 1, "splash": 0.0},
	{"id": "smg",     "name": "SMG",             "icon": "💨", "price": 2500.0,   "dmg": 7.0,  "rate": 12.0, "mag": 35, "reload": 1.6, "speed": 750.0,  "spread": 0.10,  "pellets": 1, "splash": 0.0},
	{"id": "shotgun", "name": "Shotgun",         "icon": "💥", "price": 12000.0,  "dmg": 9.0,  "rate": 1.3,  "mag": 6,  "reload": 2.0, "speed": 600.0,  "spread": 0.30,  "pellets": 7, "splash": 0.0},
	{"id": "sniper",  "name": "Sniper",          "icon": "🎯", "price": 60000.0,  "dmg": 70.0, "rate": 0.8,  "mag": 4,  "reload": 2.4, "speed": 1500.0, "spread": 0.005, "pellets": 1, "splash": 0.0},
	{"id": "rocket",  "name": "Rocket Launcher", "icon": "🚀", "price": 400000.0, "dmg": 55.0, "rate": 0.7,  "mag": 2,  "reload": 2.8, "speed": 420.0,  "spread": 0.02,  "pellets": 1, "splash": 70.0},
]
const STATS = {"dmg": "Damage", "rate": "Fire rate", "mag": "Magazine", "armor": "Armor"}
const MAX_LVL = 10
const STEAL = 0.10

const LEVELS = ["Street Hustler", "Small Business", "Franchise", "Corporation", "Conglomerate", "Megacorp", "Galactic Empire"]
const MAX_BIZ = 7
const PERKS = {
	"income":  {"name": "Income",       "icon": "💵", "desc": "+25% income",          "max": 20},
	"dmg":     {"name": "Firepower",    "icon": "🔥", "desc": "+10% weapon damage",   "max": 10},
	"hp":      {"name": "Toughness",    "icon": "❤️", "desc": "+10% max health",      "max": 10},
	"speed":   {"name": "Agility",      "icon": "👟", "desc": "+5% move speed",       "max": 8},
	"cash":    {"name": "Head Start",   "icon": "💼", "desc": "x10 starting cash",    "max": 5},
	"offline": {"name": "Night Shift",  "icon": "🌙", "desc": "+1h offline earnings", "max": 10},
	"luck":    {"name": "Lucky Streak", "icon": "🍀", "desc": "More frequent events", "max": 5},
}
const EVENTS = {
	"boom":  {"name": "Market Boom",  "icon": "📈", "desc": "x3 income for 30s",                  "dur": 30},
	"sale":  {"name": "Fire Sale",    "icon": "🏷️", "desc": "Buildings 40% off for 30s",          "dur": 30},
	"crate": {"name": "Golden Crate", "icon": "🎁", "desc": "Claim within 15s for 90s of income!", "dur": 15},
}
const MILESTONES = [25, 50, 100, 200]
const RIVAL_NAMES = ["xXSniperXx", "MoneyMike", "LemonLord", "BigBankBob", "NoScopeNina", "TycoonTina", "RocketRay", "CashCarl", "SprayPray", "GoldGabe", "FrugalFred", "OilBaronOz", "SpaceSam", "PennyPia", "CoinKing", "ShotgunSue", "ArcadeAce", "FactoryFay", "RichRick", "DollarDee", "BrokeBen", "JackpotJo", "VaultVic", "StonksSteve"]

const W = 900.0
const H = 560.0
const R = 14.0
const SPEED = 210.0
const TICK = 1.0 / 30.0
const TIME_LIMIT = 180.0
const CELL = 20
const MAPS = [
	{"name": "Warehouse", "walls": [[200, 120, 40, 140], [660, 300, 40, 140], [400, 60, 100, 30], [400, 470, 100, 30], [120, 400, 120, 30], [660, 130, 120, 30], [420, 250, 60, 60]]},
	{"name": "Pillars",   "walls": [[180, 100, 50, 50], [180, 410, 50, 50], [670, 100, 50, 50], [670, 410, 50, 50], [425, 160, 50, 50], [425, 350, 50, 50], [300, 255, 50, 50], [550, 255, 50, 50]]},
	{"name": "Corridors", "walls": [[150, 0, 30, 200], [150, 360, 30, 200], [720, 0, 30, 200], [720, 360, 30, 200], [330, 150, 240, 30], [330, 380, 240, 30]]},
	{"name": "Vault",     "walls": [[300, 140, 300, 25], [300, 395, 300, 25], [300, 140, 25, 100], [575, 320, 25, 100], [80, 260, 80, 40], [740, 260, 80, 40]]},
]

func now_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0

func fmt(n: float) -> String:
	n = floor(n)
	var units = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx"]
	var i = 0
	var x = n
	while abs(x) >= 1000.0 and i < units.size() - 1:
		x /= 1000.0
		i += 1
	if i == 0:
		return "$" + str(int(x)) + units[i]
	# "%.2f" rounds like JavaScript's toFixed except on exact ties (x.125, x.375, x.625, x.875), which it
	# rounds to even and toFixed rounds up
	var e = x * 8.0
	if e == floor(e) and int(e) % 2 == 1:
		x += 0.001
	return "$" + ("%.2f" % x) + units[i]

func weapon(id: String) -> Dictionary:
	for w in WEAPONS:
		if w.id == id:
			return w
	return WEAPONS[0]

func building(id: String):
	for b in BUILDINGS:
		if b.id == id:
			return b
	return null

# ---------- Tycoon ----------
func fresh_weapons() -> Dictionary:
	return {"pistol": {"dmg": 0, "rate": 0, "mag": 0, "armor": 0}}

func new_tycoon() -> Dictionary:
	return {"money": 50.0, "buildings": {}, "weapons": fresh_weapons(), "equipped": "pistol", "level": 1, "prestige": 0, "points": 0, "perks": {}, "event": null}

# Fills in fields added in later versions so older saves keep working.
func upgrade_save(t) -> Dictionary:
	var out = new_tycoon()
	if typeof(t) == TYPE_DICTIONARY:
		for k in t:
			out[k] = t[k]
	for k in ["level"]:
		out[k] = int(out[k]) if out[k] else 1
	out.prestige = int(out.prestige) if out.prestige else 0
	out.points = int(out.points) if out.points else 0
	if typeof(out.perks) != TYPE_DICTIONARY:
		out.perks = {}
	return out

func perk(t, k) -> int:
	return int(t.perks.get(k, 0))

func perk_cost(t, k) -> int:
	return 1 + perk(t, k) / 2

func reboot_cost(t) -> float:
	if int(t.level) < MAX_BIZ:
		return 25000.0 * pow(25.0, int(t.level) - 1)
	return 1e11 * pow(4.0, int(t.prestige))

func prestige_points(t) -> int:
	if int(t.level) < MAX_BIZ:
		return 0
	return 1 + max(0, int(floor(log(t.money / reboot_cost(t)) / log(2.0))))

func owned(t, id) -> int:
	return int(t.buildings[id].count) if t.buildings.has(id) else 0

func b_level(t, id) -> int:
	return int(t.buildings[id].level) if t.buildings.has(id) else 0

func unlocked(t, b) -> bool:
	return int(t.level) >= b.unlock

func event_on(t, type) -> bool:
	return t.event != null and t.event.type == type and t.event.until > now_ms()

# Buildings cost 1.5x more at each business level, so the x2 income a reboot brings still speeds you up,
# but a new run still takes saving up for each new building.
func price_mult(t) -> float:
	return pow(1.5, int(t.level) - 1)

func b_cost(t, b) -> float:
	return b.base * pow(1.15, owned(t, b.id)) * price_mult(t) * (0.6 if event_on(t, "sale") else 1.0)

func b_up_cost(t, b) -> float:
	return b.base * 25.0 * pow(4.0, b_level(t, b.id)) * price_mult(t)

func milestone_mult(n) -> float:
	var m = 1.0
	for x in MILESTONES:
		if n >= x:
			m *= 2.0
	return m

func next_milestone(n):
	for x in MILESTONES:
		if n < x:
			return x
	return null

func global_mult(t) -> float:
	return pow(2.0, int(t.level) - 1) * (1.0 + 0.25 * perk(t, "income")) * (3.0 if event_on(t, "boom") else 1.0)

func b_income(t, b) -> float:
	var n = owned(t, b.id)
	return n * b.income * pow(2.0, b_level(t, b.id)) * milestone_mult(n) * global_mult(t)

func income(t) -> float:
	var s = 0.0
	for b in BUILDINGS:
		s += b_income(t, b)
	return s

func up_cost(t, w, stat) -> float:
	return max(200.0, (w.price if w.price > 0 else 800.0) * 0.35) * pow(1.6, int(t.weapons[w.id][stat]))

func offline_earnings(t, seconds: float) -> float:
	var base = t.duplicate()
	base.event = null
	return income(base) * clamp(seconds, 0.0, 7200.0 + 3600.0 * perk(t, "offline")) * 0.5

func start_cash(t) -> float:
	return 50.0 * pow(10.0, perk(t, "cash"))

# Call once per second. Returns the new event type, or "".
func roll_event(t) -> String:
	if t.event != null and t.event.until > now_ms():
		return ""
	t.event = null
	if not (income(t) > 0) or randf() > (1.0 + 0.3 * perk(t, "luck")) / 120.0:
		return ""
	var keys = EVENTS.keys()
	var type = keys[randi() % keys.size()]
	t.event = {"type": type, "until": now_ms() + EVENTS[type].dur * 1000.0}
	return type

# ---------- Quests (port of the quest section of ../shared.js; the words come from models.json) ----------
const QUEST_KINDS = {
	"plaza": ["wins", "crate", "cash", "variety", "weapon", "income", "winwith"],
	"lemon": ["buy", "upgrade", "milestone", "cash", "income", "crate"], "cafe": ["buy", "milestone", "upgrade", "income", "crate", "cash"],
	"arcade": ["buy", "upgrade", "wins", "milestone", "income", "winwith"], "bank": ["cash", "income", "buy", "upgrade", "variety", "milestone"],
	"fact": ["buy", "upgrade", "milestone", "income", "weapon", "wins"], "oil": ["buy", "income", "upgrade", "wins", "milestone", "cash"],
	"space": ["buy", "milestone", "income", "weapon", "upgrade", "winwith"], "ailab": ["upgrade", "buy", "income", "variety", "milestone", "weapon"],
	"dyson": ["buy", "income", "milestone", "upgrade", "cash", "wins"],
}
const QUEST_PAY = {"buy": 90, "milestone": 240, "upgrade": 160, "income": 300, "cash": 120, "wins": 200, "winwith": 260, "crate": 120, "variety": 220, "weapon": 150}
var _qtext = null

func quest_areas() -> Array:
	var out = ["plaza"]
	for b in BUILDINGS:
		out.append(b.id)
	return out

func quest_text() -> Dictionary:
	if _qtext == null:
		var f = FileAccess.open("res://models.json", FileAccess.READ)
		_qtext = JSON.parse_string(f.get_as_text()).QUEST_TEXT
	return _qtext

func _imul(a: int, b: int) -> int:
	return (a * b) & 0xFFFFFFFF

func qhash(keys: Array) -> int:
	var h = 2166136261
	for v in keys:
		v = int(v)
		h = _imul(h ^ (v & 0xffff), 16777619)
		h = _imul(h ^ ((v >> 16) & 0xffff), 16777619)
	h ^= h >> 15
	h = _imul(h, 2246822507)
	h ^= h >> 13
	return h % 2147483646 + 1

# seeded random numbers: call .call() for the next one in [0, 1)
func qrng(seed: int) -> Callable:
	var st = [seed]
	return func() -> float:
		st[0] = (st[0] * 16807) % 2147483647
		return st[0] / 2147483647.0

func qpick(r: Callable, list: Array):
	return list[int(floor(r.call() * list.size()))]

func reboots(t) -> int:
	return (int(t.level) - 1) + int(t.prestige)

func qseed(area: String, rb: int, n: int, salt := 0) -> int:
	return qhash([quest_areas().find(area) + 1, rb, n + 1, salt])

# stats count for good; run counts since the last reboot (what a reboot asks for: reboot_goals)
func quest_state(t) -> Dictionary:
	if typeof(t.get("quest")) != TYPE_DICTIONARY:
		t.quest = {"stats": {"wins": 0, "crates": 0, "with": {}}, "areas": {}}
	if typeof(t.quest.get("run")) != TYPE_DICTIONARY:
		t.quest.run = {"wins": 0, "jobs": 0}
	return t.quest

func quest_area(t, area: String) -> Dictionary:
	var q = quest_state(t)
	if not q.areas.has(area):
		q.areas[area] = {"n": 0, "active": null}
	return q.areas[area]

# The person in an area for this reboot.
func quest_giver(t, area: String) -> Dictionary:
	var T = quest_text()
	var r = qrng(qseed(area, reboots(t), -1))
	var name = qpick(r, T.first) + " " + qpick(r, T.last)
	return {"name": name, "role": qpick(r, T.roles[area]), "mood": qpick(r, T.moods.keys()), "look": int(floor(r.call() * 1000))}

func weapon_ups(t) -> int:
	var s = 0
	for w in t.weapons.values():
		s += int(w.dmg) + int(w.rate) + int(w.mag) + int(w.armor)
	return s

func kinds_owned(t) -> int:
	var k = 0
	for b in BUILDINGS:
		if owned(t, b.id) > 0:
			k += 1
	return k

func unlocked_count(t) -> int:
	var k = 0
	for b in BUILDINGS:
		if unlocked(t, b):
			k += 1
	return k

# rounds up to 3 significant figures (the exponent found exactly, like shared.js)
func round3(v: float) -> float:
	if v <= 0:
		return 0.0
	var e = floor(log(v) / log(10.0))
	if pow(10.0, e + 1) <= v: e += 1
	if pow(10.0, e) > v: e -= 1
	var p = pow(10.0, e - 2)
	return ceil(v / p) * p

func quest_kind(t, area: String, n: int) -> String:
	var r = qrng(qseed(area, reboots(t), n))
	var list = QUEST_KINDS[area]
	var prev_kind = ""
	if n > 0:
		prev_kind = list[int(floor(qrng(qseed(area, reboots(t), n - 1)).call() * list.size()))]
	var k = int(floor(r.call() * list.size()))
	var b = building(area)
	for tries in list.size():
		var kind = list[k]
		k = (k + 1) % list.size()
		if kind == prev_kind: continue
		if kind == "variety" and kinds_owned(t) >= unlocked_count(t): continue
		if kind == "milestone" and b != null and owned(t, b.id) >= MILESTONES[MILESTONES.size() - 1]: continue
		if kind == "weapon":
			var maxed = true
			for w in t.weapons.values():
				if int(w.dmg) + int(w.rate) + int(w.mag) + int(w.armor) < 4 * MAX_LVL:
					maxed = false
			if maxed: continue
		return kind
	return list[0]

func quest_offer(t, area: String) -> Dictionary:
	var st = quest_area(t, area)
	var n = int(st.n)
	var r = qrng(qseed(area, reboots(t), n, 1))
	var kind = quest_kind(t, area, n)
	var b = building(area)
	var owns = t.weapons.keys()
	var w = null
	if kind == "winwith":
		w = owns[int(floor(r.call() * owns.size()))]
	return {"area": area, "kind": kind, "id": b.id if b != null else null, "w": w, "size": r.call(), "why": int(floor(r.call() * 1000)), "ask": int(floor(r.call() * 1000))}

# What the job needs, from the business as it is now (taken when you accept): {base, target}
func quest_target(t, o: Dictionary) -> Dictionary:
	var q = quest_state(t)
	var s = float(o.size)
	var id = o.id
	match o.kind:
		"buy": return {"base": owned(t, id), "target": owned(t, id) + [3, 5, 8, 10, 12, 15][int(floor(s * 6))]}
		"upgrade": return {"base": b_level(t, id), "target": b_level(t, id) + (2 if s > 0.75 else 1)}
		"milestone":
			var nm = next_milestone(owned(t, id))
			return {"base": owned(t, id), "target": nm if nm != null else owned(t, id) + 25}
		"income": return {"base": income(t), "target": round3(max(5.0, income(t) * (1.5 + s * 1.5)))}
		"cash": return {"base": t.money, "target": round3(max(200.0, max(t.money * 1.3, income(t) * (60 + s * 180))))}
		"wins": return {"base": int(q.stats.wins), "target": int(q.stats.wins) + 1 + int(floor(s * 3))}
		"winwith": return {"base": int(q.stats.with.get(o.w, 0)), "target": int(q.stats.with.get(o.w, 0)) + 1}
		"crate": return {"base": int(q.stats.crates), "target": int(q.stats.crates) + (2 if s > 0.7 else 1)}
		"variety":
			var k = kinds_owned(t)
			return {"base": k, "target": min(unlocked_count(t), k + (2 if s > 0.6 else 1))}
		"weapon": return {"base": weapon_ups(t), "target": weapon_ups(t) + 2 + int(floor(s * 3))}
	return {"base": 0, "target": 1}

# How far along the active job in an area is: [now, target] (null if none).
func quest_progress(t, area: String):
	var a = quest_area(t, area).active
	if a == null:
		return null
	var q = quest_state(t)
	var now = 0.0
	match a.kind:
		"buy", "milestone": now = owned(t, a.id)
		"upgrade": now = b_level(t, a.id)
		"income": now = income(t)
		"cash": now = t.money
		"wins": now = int(q.stats.wins)
		"winwith": now = int(q.stats.with.get(a.w, 0))
		"crate": now = int(q.stats.crates)
		"variety": now = kinds_owned(t)
		"weapon": now = weapon_ups(t)
	return [now, a.target]

func quest_done(t, area: String) -> bool:
	var p = quest_progress(t, area)
	return p != null and p[0] >= p[1]

func quest_reward(t, area: String) -> float:
	var st = quest_area(t, area)
	var kind = st.active.kind if st.active != null else quest_offer(t, area).kind
	return max(250.0 * pow(2.0, int(t.level) - 1), income(t) * QUEST_PAY[kind] * (1 + 0.15 * min(10, int(st.n))))

# The words: who's talking and what they say about the current (or offered) job.
func quest_talk(t, area: String) -> Dictionary:
	var T = quest_text()
	var g = quest_giver(t, area)
	var m = T.moods[g.mood]
	var st = quest_area(t, area)
	var a = st.active
	var o = a if a != null else quest_offer(t, area)
	var r = qrng(qseed(area, reboots(t), int(st.n), 2))
	var tg = a if a != null else quest_target(t, o)
	# {n}: how many more for the counting jobs, the total for the rest
	var n = tg.target - tg.base if o.kind in ["buy", "upgrade", "wins", "crate", "weapon"] else tg.target
	var c = ""
	if T.count.has(o.kind):
		c = T.count[o.kind][0 if int(n) == 1 else 1].replace("{n}", str(int(n)))
	var why = T.why[o.kind]
	var ask = T.ask[o.kind]
	var text = ask[int(o.ask) % ask.size()]
	text = text.replace("{c}", c).replace("{n}", str(int(n)))
	text = text.replace("{b}", building(o.id).name if o.id != null else "").replace("{bs}", T.plural[o.id] if o.id != null else "")
	text = text.replace("{amt}", fmt(tg.target)).replace("{w}", weapon(o.w).name if o.w != null else "")
	return {"name": g.name, "role": g.role, "mood": g.mood, "look": g.look, "hi": qpick(r, m.hi), "take": qpick(r, m.take), "wait": qpick(r, m.wait), "done": qpick(r, m.done),
		"why": why[int(o.why) % why.size()], "ask": text, "reward": quest_reward(t, area), "points": 1 if int(t.level) >= MAX_BIZ and (int(st.n) + 1) % 3 == 0 else 0}

# A battle won: counts towards win jobs and the next reboot.
func record_win(t) -> void:
	var q = quest_state(t)
	var s = q.stats
	s.wins = int(s.wins) + 1
	s.with[t.equipped] = int(s.with.get(t.equipped, 0)) + 1
	q.run.wins = int(q.run.wins) + 1

# ---------- What a reboot takes ----------
# Money alone only takes waiting, so a reboot also asks for work done since the last one: fights won, jobs
# finished for the people round your business, milestones reached and weapon upgrades. Every goal grows with
# each reboot, up to the 16th. (Names and descriptions: REBOOT_GOALS in models.json, from shared.js.)
func milestones_reached(t) -> int:
	var s = 0
	for b in BUILDINGS:
		for m in MILESTONES:
			if owned(t, b.id) >= m:
				s += 1
	return s

func reboot_goals(t) -> Array:
	var n = min(reboots(t) + 1, 16)
	var run = quest_state(t).run
	return [
		{"id": "cash", "have": float(t.money), "need": reboot_cost(t)},
		{"id": "wins", "have": int(run.wins), "need": min(3 + 2 * (n - 1), 25)},
		{"id": "jobs", "have": int(run.jobs), "need": min(1 + n, 10)},
		{"id": "milestones", "have": milestones_reached(t), "need": n + 1},
		{"id": "gear", "have": weapon_ups(t), "need": 2 + 2 * n},
	]

# Why you can't reboot yet ("": you can).
func reboot_blocker(t) -> String:
	for g in reboot_goals(t):
		if g.have >= g.need:
			continue
		var left = int(ceil(g.need - g.have))
		var s = "" if left == 1 else "s"
		match g.id:
			"cash": return "Need %s to reboot" % fmt(g.need)
			"wins": return "Win %d more fight%s first" % [left, s]
			"jobs": return "Finish %d more job%s for the people round your business first" % [left, s]
			"milestones": return "Reach %d more milestone%s first" % [left, s]
			_: return "Upgrade your weapons %d more time%s first" % [left, s]
	return ""

# Applies a player action. Returns an error message, or "" on success.
func apply_action(t, a: Dictionary) -> String:
	match a.get("type", ""):
		"buy":
			var b = building(a.id)
			if b == null: return "Unknown building"
			if not unlocked(t, b): return "Reach %s to unlock" % LEVELS[b.unlock - 1]
			var c = b_cost(t, b)
			if t.money < c: return "Not enough money"
			t.money -= c
			t.buildings[b.id] = {"count": owned(t, b.id) + 1, "level": b_level(t, b.id)}
		"bup":
			var b = building(a.id)
			if b == null or owned(t, b.id) == 0: return "Buy one first"
			var c = b_up_cost(t, b)
			if t.money < c: return "Not enough money"
			t.money -= c
			t.buildings[b.id].level = b_level(t, b.id) + 1
		"wbuy":
			var w = weapon(a.id)
			if t.weapons.has(a.id): return "Cannot buy"
			if t.money < w.price: return "Not enough money"
			t.money -= w.price
			t.weapons[w.id] = {"dmg": 0, "rate": 0, "mag": 0, "armor": 0}
			t.equipped = w.id
		"wup":
			var w = weapon(a.id)
			if not t.weapons.has(a.id) or not STATS.has(a.stat): return "Cannot upgrade"
			if int(t.weapons[w.id][a.stat]) >= MAX_LVL: return "Already maxed"
			var c = up_cost(t, w, a.stat)
			if t.money < c: return "Not enough money"
			t.money -= c
			t.weapons[w.id][a.stat] = int(t.weapons[w.id][a.stat]) + 1
		"equip":
			if not t.weapons.has(a.id): return "Not owned"
			t.equipped = a.id
		"claim":
			if not event_on(t, "crate"): return "The crate is gone"
			t.event = null
			t.money += max(100.0, income(t) * 90.0)
			var qs = quest_state(t).stats
			qs.crates = int(qs.crates) + 1
		"quest":
			var area = str(a.get("area", ""))
			if not quest_areas().has(area): return "Nobody there"
			if area != "plaza" and owned(t, area) == 0: return "Buy one first"
			var st = quest_area(t, area)
			match a.get("op", ""):
				"accept":
					if st.active != null: return "You already have that job"
					var o = quest_offer(t, area)
					var tg = quest_target(t, o)
					st.active = {"kind": o.kind, "id": o.id, "w": o.w, "why": o.why, "ask": o.ask, "base": tg.base, "target": tg.target}
				"claim":
					if not quest_done(t, area): return "Not done yet"
					var talk = quest_talk(t, area)
					t.money += talk.reward
					t.points = int(t.points) + talk.points
					st.n = int(st.n) + 1
					st.active = null
					quest_state(t).run.jobs = int(quest_state(t).run.jobs) + 1
				"drop": # a new job next time
					st.n = int(st.n) + 1
					st.active = null
				_:
					return "Bad action"
		"reboot":
			var blocked = reboot_blocker(t)
			if blocked != "": return blocked
			if int(t.level) < MAX_BIZ:
				t.level = int(t.level) + 1
			else:
				t.points = int(t.points) + prestige_points(t)
				t.prestige = int(t.prestige) + 1
			t.money = start_cash(t)
			t.buildings = {}
			t.weapons = fresh_weapons()
			t.equipped = "pistol"
			t.event = null
			quest_state(t).areas = {} # new people, new jobs, new goals
			quest_state(t).run = {"wins": 0, "jobs": 0}
		"perk":
			if not PERKS.has(a.id): return "Unknown perk"
			if perk(t, a.id) >= PERKS[a.id].max: return "Already maxed"
			if int(t.points) < perk_cost(t, a.id): return "Not enough Boost Points"
			t.points = int(t.points) - perk_cost(t, a.id)
			t.perks[a.id] = perk(t, a.id) + 1
		_:
			return "Unknown action"
	return ""

# ---------- Matchmaking ----------
func wealth_distance(a: float, b: float) -> float:
	return abs(log(max(1.0, a)) - log(max(1.0, b))) / log(10.0)

func power(t) -> float:
	return int(t.get("level", 1)) + 0.5 * int(t.get("prestige", 0))

func match_distance(a, b) -> float:
	return wealth_distance(a.money, b.money) + 0.4 * abs(power(a) - power(b))

func search_window(sec: float) -> float:
	return 0.15 + sec * 0.25

# ---------- Computer rivals ----------
func new_rivals() -> Array:
	var out = []
	for i in RIVAL_NAMES.size():
		var r = {"name": RIVAL_NAMES[i], "skill": 0.3 + randf() * 0.6, "recent": 0, "level": min(MAX_BIZ, 1 + i / 4), "prestige": 0}
		r.money = round(min(30.0 * pow(1.75, i) * (0.7 + randf() * 0.6), reboot_cost(r) * 0.5))
		out.append(r)
	return out

func rival_mult(r) -> float:
	return pow(2.0, int(r.level) - 1) * (1.0 + 0.25 * int(r.prestige))

# Advances one rival by dt seconds. Returns news when they reboot, else "".
func tick_rival(r, dt: float) -> String:
	if not r.get("level"): r.level = 1
	if not r.get("prestige"): r.prestige = 0
	r.money = r.money * (1.0 + 0.0015 * dt * (0.5 + r.skill)) + dt * (0.5 + r.skill) * rival_mult(r)
	if r.money < reboot_cost(r) * (1.6 - r.skill * 0.6):
		return ""
	if int(r.level) < MAX_BIZ:
		r.level = int(r.level) + 1
	else:
		r.prestige = int(r.prestige) + 1
	r.money = 500.0 * pow(3.0, int(r.level)) * (1 + int(r.prestige))
	if int(r.prestige) > 0:
		return "%s prestiged (★%d)!" % [r.name, int(r.prestige)]
	return "%s rebooted to %s!" % [r.name, LEVELS[int(r.level) - 1]]

func rival_loadout(r) -> Dictionary:
	var level = int(r.get("level", 1))
	var prestige = int(r.get("prestige", 0))
	var affordable = WEAPONS.filter(func(w): return w.price <= r.money * 0.6 * pow(2.0, level - 1))
	var idx = max(0, affordable.size() - 1 - (1 if randf() < 0.35 else 0))
	var w = affordable[idx] if affordable.size() > 0 else WEAPONS[0]
	var lvl = clampi(int(floor(log(max(10.0, r.money)) / log(10.0) * 1.3 - 2.0 + randf() * 2.0)) + (level - 1) / 2, 0, MAX_LVL)
	return {"weapons": {w.id: {"dmg": lvl, "rate": lvl, "mag": lvl, "armor": lvl}}, "equipped": w.id,
		"perks": {"hp": min(10, prestige), "dmg": min(10, prestige), "speed": min(8, prestige / 2)}}

# ---------- Arena ----------
func hits_wall(walls: Array, x: float, y: float, rad: float) -> bool:
	if x < rad or y < rad or x > W - rad or y > H - rad:
		return true
	for w in walls:
		if x + rad > w[0] and x - rad < w[0] + w[2] and y + rad > w[1] and y - rad < w[1] + w[3]:
			return true
	return false

func line_clear(walls: Array, a, b) -> bool:
	for i in range(1, 30):
		if hits_wall(walls, a.x + (b.x - a.x) * i / 30.0, a.y + (b.y - a.y) * i / 30.0, 1.0):
			return false
	return true

# Shared with client-side prediction, so the predicted player moves exactly like the server's.
func move_unit(walls: Array, u, mx: float, my: float, speed: float, dt: float) -> void:
	var m = Vector2(mx, my).length()
	if m > 1.0:
		mx /= m
		my /= m
	if not hits_wall(walls, u.x + mx * speed * dt, u.y, R):
		u.x += mx * speed * dt
	if not hits_wall(walls, u.x, u.y + my * speed * dt, R):
		u.y += my * speed * dt

func make_gun(id: String, up: Dictionary, dmg_perk: int = 0) -> Dictionary:
	var g = weapon(id).duplicate()
	var mag = int(round(g.mag * (1.0 + 0.15 * int(up.mag))))
	g.dmg = g.dmg * (1.0 + 0.15 * int(up.dmg)) * (1.0 + 0.1 * dmg_perk)
	g.rate = g.rate * (1.0 + 0.08 * int(up.rate))
	g.mag = mag
	g.ammo = mag
	g.cd = 0.0
	g.reloading = 0.0
	g.armor = int(up.armor)
	return g

func new_arena(la, lb, map_index: int = -1) -> Dictionary:
	if map_index < 0:
		map_index = randi() % MAPS.size()
	return {"map": map_index, "walls": MAPS[map_index].walls, "units": [_unit(la, 60.0, 0.0), _unit(lb, W - 60.0, PI)], "bullets": [], "fx": [], "t": 0.0}

func _unit(l, x: float, ang: float) -> Dictionary:
	var p = l.get("perks", {})
	var mhp = 100.0 * (1.0 + 0.1 * int(p.get("hp", 0)))
	return {"x": x, "y": H / 2, "hp": mhp, "mhp": mhp, "ang": ang, "speed": SPEED * (1.0 + 0.05 * int(p.get("speed", 0))),
		"dmg_perk": int(p.get("dmg", 0)), "weapons": l.weapons, "gun": make_gun(l.equipped, l.weapons[l.equipped], int(p.get("dmg", 0))), "ai": {"strafe": 1.0, "think": 0.0}}

func _reload(u) -> void:
	if u.gun.reloading <= 0 and u.gun.ammo < u.gun.mag:
		u.gun.reloading = u.gun.reload

func _shoot(A, u, owner: int) -> void:
	var g = u.gun
	if g.cd > 0 or g.reloading > 0:
		return
	if g.ammo <= 0:
		_reload(u)
		return
	g.ammo -= 1
	g.cd = 1.0 / g.rate
	for i in g.pellets:
		var a = u.ang + (randf() - 0.5) * g.spread * 2.0
		A.bullets.append({"x": u.x + cos(a) * 18, "y": u.y + sin(a) * 18, "vx": cos(a) * g.speed, "vy": sin(a) * g.speed, "dmg": g.dmg, "owner": owner, "splash": g.splash, "life": 1.5})
	if g.ammo <= 0:
		_reload(u)

func _damage(u, d: float) -> void:
	u.hp -= d / (1.0 + 0.1 * u.gun.armor)

# input = {mx, my, ang, shoot, reload, sw}. Returns winner index, or -1 while the fight goes on.
func step_arena(A, inputs: Array, dt: float) -> int:
	A.t += dt
	for i in 2:
		var u = A.units[i]
		var inp = inputs[i]
		u.gun.cd -= dt
		if u.gun.reloading > 0:
			u.gun.reloading -= dt
			if u.gun.reloading <= 0:
				u.gun.reloading = 0.0
				u.gun.ammo = u.gun.mag
		var sw = inp.get("sw", "")
		if sw != "" and sw != u.gun.id and u.weapons.has(sw):
			u.gun = make_gun(sw, u.weapons[sw], u.dmg_perk)
		if inp.get("reload", false):
			_reload(u)
		move_unit(A.walls, u, inp.get("mx", 0.0), inp.get("my", 0.0), u.speed, dt)
		u.ang = inp.get("ang", u.ang)
		if inp.get("shoot", false) and A.t > 0.8:
			_shoot(A, u, i)
	for b in A.bullets:
		b.x += b.vx * dt
		b.y += b.vy * dt
		b.life -= dt
		var tgt = A.units[1 - b.owner]
		var hit_wall = hits_wall(A.walls, b.x, b.y, 2.0)
		var hit_unit = not hit_wall and Vector2(tgt.x - b.x, tgt.y - b.y).length() < R + 1
		if hit_unit and b.splash <= 0:
			_damage(tgt, b.dmg)
		if hit_unit:
			A.fx.append({"x": b.x, "y": b.y, "r": 8.0, "t": 0.15})
		if hit_wall or hit_unit:
			b.life = 0.0
			if b.splash > 0:
				A.fx.append({"x": b.x, "y": b.y, "r": b.splash, "t": 0.3})
				for j in 2:
					var u = A.units[j]
					var d = Vector2(u.x - b.x, u.y - b.y).length()
					if d < b.splash:
						_damage(u, b.dmg * (1.0 - d / b.splash) * (1.0 if j == 1 - b.owner else 0.4))
	A.bullets = A.bullets.filter(func(b): return b.life > 0)
	for f in A.fx:
		f.t -= dt
	A.fx = A.fx.filter(func(f): return f.t > 0)
	var a = A.units[0]
	var c = A.units[1]
	if a.hp <= 0 or c.hp <= 0 or A.t >= TIME_LIMIT:
		var ra = a.hp / a.mhp
		var rc = c.hp / c.mhp
		if ra > rc: return 0
		if rc > ra: return 1
		return randi() % 2
	return -1

# Breadth-first search over a 20px grid; returns a point a few cells along the shortest path
# from `from` to `to`, or null if there's no path. Lets bots walk around walls instead of into them.
func next_waypoint(walls: Array, from, to):
	var cols = int(W / CELL)
	var rows = int(H / CELL)
	var sc = clampi(int(from.x / CELL), 0, cols - 1)
	var sr = clampi(int(from.y / CELL), 0, rows - 1)
	var goal = clampi(int(to.y / CELL), 0, rows - 1) * cols + clampi(int(to.x / CELL), 0, cols - 1)
	var prev = {sr * cols + sc: -1}
	var q = [Vector2i(sc, sr)]
	var qi = 0
	while qi < q.size() and not prev.has(goal):
		var cur = q[qi]
		qi += 1
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var n = cur + d
			var k = n.y * cols + n.x
			if n.x < 0 or n.y < 0 or n.x >= cols or n.y >= rows or prev.has(k):
				continue
			if k != goal and hits_wall(walls, n.x * CELL + CELL / 2.0, n.y * CELL + CELL / 2.0, R):
				continue
			prev[k] = cur.y * cols + cur.x
			q.append(n)
	if not prev.has(goal):
		return null
	var path = []
	var k = goal
	while k != -1:
		path.append(k)
		k = prev[k]
	k = path[max(0, path.size() - 4)]
	return {"x": (k % cols) * CELL + CELL / 2.0, "y": (k / cols) * CELL + CELL / 2.0}

func bot_input(A, i: int, skill: float) -> Dictionary:
	var e = A.units[i]
	var p = A.units[1 - i]
	var ai = e.ai
	var dx = p.x - e.x
	var dy = p.y - e.y
	var dist = max(1.0, Vector2(dx, dy).length())
	var see = line_clear(A.walls, e, p)
	ai.think -= 1.0 / 60.0
	if ai.think <= 0:
		ai.think = 0.6 + randf()
		ai.strafe = -1.0 if randf() < 0.5 else 1.0
	var pref = 120.0 if e.gun.id == "shotgun" else (420.0 if e.gun.id == "sniper" else 260.0)
	var ax = 0.0
	var ay = 0.0
	if not see:
		# no line of sight: follow a path around the walls
		ai.pathT = ai.get("pathT", 0.0) - 1.0 / 60.0
		if ai.pathT <= 0 or ai.get("wp") == null:
			ai.pathT = 0.3
			var wp = next_waypoint(A.walls, e, p)
			ai.wp = wp if wp != null else {"x": p.x, "y": p.y}
		var wv = Vector2(ai.wp.x - e.x, ai.wp.y - e.y)
		var wd = max(1.0, wv.length())
		ax = wv.x / wd; ay = wv.y / wd
	else:
		if dist > pref + 40:
			ax = dx / dist; ay = dy / dist
		elif dist < pref - 40:
			ax = -dx / dist; ay = -dy / dist
		ax += -dy / dist * ai.strafe * 0.8
		ay += dx / dist * ai.strafe * 0.8
	var m = max(0.0001, Vector2(ax, ay).length())
	ax /= m; ay /= m
	if see and hits_wall(A.walls, e.x + ax * 8, e.y + ay * 8, R):
		ai.strafe *= -1.0
	var scale = 0.8 + 0.2 * skill
	return {"mx": ax * scale, "my": ay * scale, "ang": atan2(dy, dx) + (randf() - 0.5) * (0.5 - 0.4 * skill), "shoot": see}

# Same shape as the server's snapshots, so one renderer draws both modes.
func snapshot(A) -> Dictionary:
	var us = []
	for u in A.units:
		us.append({"x": u.x, "y": u.y, "hp": max(0, round(u.hp)), "mhp": round(u.mhp), "ang": u.ang, "sp": u.speed,
			"g": {"id": u.gun.id, "ammo": u.gun.ammo, "mag": u.gun.mag, "rl": u.gun.reloading > 0}})
	var bs = []
	for b in A.bullets:
		bs.append([b.x, b.y, 1 if b.splash > 0 else 0, b.vx, b.vy])
	var fx = []
	for f in A.fx:
		fx.append([f.x, f.y, f.r, f.t])
	return {"t": A.t, "m": A.map, "u": us, "b": bs, "fx": fx}
