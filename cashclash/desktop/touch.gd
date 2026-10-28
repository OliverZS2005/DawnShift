# On-screen controls for phones and tablets (Game.mobile), laid over the city and the fight. A stick appears
# wherever your left thumb lands (walk; pushed all the way you run), dragging anywhere else turns your head,
# and round buttons sit along the right edge. Owners read `stick` and take_look() every frame and set
# `buttons` to what makes sense right now; a tap on a button emits pressed(id), and held(id) says whether
# it's still down (the fire button).
extends Control

signal pressed(id: String)

const STICK_R := 46.0 # how far the stick moves (canvas units)
const INK := Color(0.043, 0.051, 0.063, 0.55)
const EDGE := Color(0.95, 0.94, 0.91, 0.35)
const TEXT := Color("#F2EFE8")

# [{id, label, at: Vector2 measured from the bottom-right corner (or top-right with top = true), r, accent}]
var buttons := []
var hint_at := Vector2(110, 110) # where the stick's faint outline sits while untouched, from the bottom-left
var stick := Vector2.ZERO # x: right, y: forward, length up to 1
var _look := Vector2.ZERO
var _stick_id := -1
var _stick_from := Vector2.ZERO
var _stick_at := Vector2.ZERO
var _look_id := -1
var _held := {} # touch index -> button id
var _font: Font

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_font = R3D.font("barlow-condensed-800")

# The drag (canvas units) since the last call.
func take_look() -> Vector2:
	var l = _look
	_look = Vector2.ZERO
	return l

func held(id: String) -> bool:
	return _held.values().has(id)

func set_buttons(list: Array) -> void:
	if str(list) != str(buttons):
		buttons = list
		queue_redraw()

func release_all() -> void:
	_stick_id = -1
	_look_id = -1
	_held = {}
	stick = Vector2.ZERO
	queue_redraw()

func _centre(b: Dictionary) -> Vector2:
	var at: Vector2 = b.at
	return Vector2(size.x - at.x, at.y if b.get("top", false) else size.y - at.y)

func _button_at(p: Vector2):
	for b in buttons:
		if p.distance_to(_centre(b)) <= float(b.r) + 8.0:
			return b
	return null

func _input(e: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if e is InputEventScreenTouch:
		var p = e.position - get_global_rect().position
		if e.pressed:
			if not Rect2(Vector2.ZERO, size).has_point(p):
				return
			var b = _button_at(p)
			if b != null:
				_held[e.index] = b.id
				pressed.emit(b.id)
			elif p.x < size.x * 0.42 and _stick_id < 0:
				_stick_id = e.index
				_stick_from = p
				_stick_at = p
			elif _look_id < 0:
				_look_id = e.index
			queue_redraw()
		else:
			if e.index == _stick_id:
				_stick_id = -1
				stick = Vector2.ZERO
			if e.index == _look_id:
				_look_id = -1
			_held.erase(e.index)
			queue_redraw()
	elif e is InputEventScreenDrag:
		if e.index == _stick_id:
			_stick_at = e.position - get_global_rect().position
			var d = (_stick_at - _stick_from) / STICK_R
			if d.length() > 1.0:
				d = d.normalized()
			stick = Vector2(d.x, -d.y)
			queue_redraw()
		elif e.index == _look_id:
			_look += e.relative

func _notification(what: int) -> void:
	if what == NOTIFICATION_VISIBILITY_CHANGED and not is_visible_in_tree():
		release_all()

func _draw() -> void:
	# the stick: where your thumb landed, and the knob where it is now (a faint hint while untouched)
	if _stick_id >= 0:
		draw_circle(_stick_from, STICK_R + 10, INK)
		draw_arc(_stick_from, STICK_R + 10, 0, TAU, 48, EDGE, 2.0, true)
		draw_circle(_stick_from + (_stick_at - _stick_from).limit_length(STICK_R), 24, Color(TEXT, 0.75))
	else:
		var at = Vector2(hint_at.x, size.y - hint_at.y)
		draw_arc(at, STICK_R + 10, 0, TAU, 48, Color(EDGE, 0.25), 2.0, true)
		draw_string(_font, at + Vector2(-60, 5), "MOVE", HORIZONTAL_ALIGNMENT_CENTER, 120, 15, Color(TEXT, 0.3))
	for b in buttons:
		var c = _centre(b)
		var down = held(b.id)
		var accent = b.get("accent", false)
		draw_circle(c, b.r, Color(Color("#f5c542") if accent else INK, 0.85 if down else (0.7 if accent else 0.55)))
		draw_arc(c, b.r, 0, TAU, 48, EDGE, 2.0, true)
		var fs = 15 if str(b.label).length() > 6 else 18
		draw_string(_font, c + Vector2(-b.r, fs * 0.35), b.label, HORIZONTAL_ALIGNMENT_CENTER, b.r * 2, fs, Color("#111111") if accent else TEXT)
