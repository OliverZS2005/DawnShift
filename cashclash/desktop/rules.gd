# Game rules: a GDScript port of ../shared.js. Keep the two in step — the desktop app
# shares saves with the web version and plays on the same multiplayer servers.
extends Node

const BUILDINGS = [
	{"id": "lemon",  "name": "Lemonade Stand", "icon": "🍋", "base": 15.0,     "income": 1.0,       "unlock": 1},
	{"id": "cafe",   "name": "Coffee Shop",    "icon": "☕", "base": 120.0,    "income": 6.0,       "unlock": 1},
	{"id": "arcade", "name": "Arcade",         "icon": "🕹️", "base": 1300.0,   "income": 40.0,      "unlock": 1},
	{"id": "fact",   "name": "Factory",        "icon": "🏭", "base": 14000.0,  "income": 260.0,     "unlock": 2},
	{"id": "bank",   "name": "Bank",           "icon": "🏦", "base": 160000.0, "income": 1800.0,    "unlock": 3},
	{"id": "oil",    "name": "Oil Rig",        "icon": "🛢️", "base": 2.2e6,    "income": 14000.0,   "unlock": 4},
	{"id": "space",  "name": "Space Mine",     "icon": "🚀", "base": 3.5e7,    "income": 120000.0,  "unlock": 5},
	{"id": "ailab",  "name": "AI Lab",         "icon": "🧠", "base": 6e8,      "income": 1.1e6,     "unlock": 6},
	{"id": "dyson",  "name": "Dyson Sphere",   "icon": "☀️", "base": 1.2e10,   "income": 1.2e7,     "unlock": 7},
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
	return "$" + ("%.2f" % x if i > 0 else str(int(x))) + units[i]

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

func b_cost(t, b) -> float:
	return b.base * pow(1.15, owned(t, b.id)) * (0.6 if event_on(t, "sale") else 1.0)

func b_up_cost(t, b) -> float:
	return b.base * 25.0 * pow(4.0, b_level(t, b.id))

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
		"reboot":
			if t.money < reboot_cost(t): return "Need %s to reboot" % fmt(reboot_cost(t))
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
