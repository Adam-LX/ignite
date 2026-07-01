class_name SimulatedInput
extends RefCounted
## Bufor wejścia bota — port SimulatedInput.ts

var forward: bool = false
var backward: bool = false
var left: bool = false
var right: bool = false
var roll_left: bool = false
var roll_right: bool = false
var jump: bool = false
var boost: bool = false


static func create_empty() -> SimulatedInput:
	return SimulatedInput.new()


func clear_frame() -> void:
	forward = false
	backward = false
	left = false
	right = false
	roll_left = false
	roll_right = false
	jump = false
	boost = false
