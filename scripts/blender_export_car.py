#!/usr/bin/env python3
"""
Blender (headless): Dominus-style RL car → player_car.glb

Oś: X = szerokość, Y = wysokość, Z = długość (przód = −Z).
Three.js: obrót Y=π w carGlbLoader.ts.
Dno opon: Y = 0.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(os.environ.get("FLYBALL_ROOT", Path(__file__).resolve().parents[1]))
OUT_GLB = ROOT / "public" / "assets" / "models" / "player_car.glb"

# Wymiary wizualne (Octane hitbox w metrach)
L = 1.18
W = 0.68
H = 0.34
WHEEL_R = 0.125
WHEEL_W = 0.088
WHEEL_Y = WHEEL_R
WX = W * 0.455
WZ_F = L * 0.30
WZ_R = -L * 0.28

HL = L * 0.5


def clear_scene() -> None:
	bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj: bpy.types.Object) -> None:
	bpy.context.scene.collection.objects.link(obj)


def mat_paint(name: str, rgb: tuple[float, float, float]) -> bpy.types.Material:
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
		bsdf.inputs["Metallic"].default_value = 0.78
		bsdf.inputs["Roughness"].default_value = 0.16
		if "Coat Weight" in bsdf.inputs:
			bsdf.inputs["Coat Weight"].default_value = 0.42
	return mat


def mat_dark(name: str, rgb: tuple[float, float, float]) -> bpy.types.Material:
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
		bsdf.inputs["Metallic"].default_value = 0.55
		bsdf.inputs["Roughness"].default_value = 0.28
	return mat


def mat_chrome(name: str) -> bpy.types.Material:
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = (0.9, 0.92, 0.96, 1.0)
		bsdf.inputs["Metallic"].default_value = 0.96
		bsdf.inputs["Roughness"].default_value = 0.1
	return mat


def mat_glass(name: str) -> bpy.types.Material:
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = (0.05, 0.08, 0.12, 1.0)
		bsdf.inputs["Roughness"].default_value = 0.05
		bsdf.inputs["Transmission Weight"].default_value = 0.45
	return mat


def mat_rubber(name: str) -> bpy.types.Material:
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get("Principled BSDF")
	if bsdf:
		bsdf.inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1.0)
		bsdf.inputs["Roughness"].default_value = 0.9
	return mat


def assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
	if obj.data.materials:
		obj.data.materials[0] = mat
	else:
		obj.data.materials.append(mat)


def smoothstep(edge0: float, edge1: float, x: float) -> float:
	t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
	return t * t * (3.0 - 2.0 * t)


def station_t(z: float) -> float:
	"""0 = przód (−HL), 1 = tył (+HL)."""
	return (z + HL) / L


def dominus_half_width(z: float) -> float:
	"""Szerokość połówki — wąski nos, szerokie błotniki z tyłu."""
	t = station_t(z)
	nose = 1.0 - smoothstep(0.0, 0.22, t)
	rear = smoothstep(0.55, 0.92, t)
	base = 0.30 + 0.04 * nose
	mid = smoothstep(0.18, 0.48, t) * 0.06
	fender = smoothstep(0.35, 0.72, t) * 0.05 * (1.0 + 0.35 * rear)
	return W * (base + mid + fender)


def dominus_ridge_height(z: float) -> float:
	"""Wysokość grzbietu / dachu wzdłuż osi."""
	t = station_t(z)
	nose = 1.0 - smoothstep(0.0, 0.28, t)
	cabin = smoothstep(0.42, 0.62, t) * (1.0 - smoothstep(0.72, 0.95, t))
	hood = smoothstep(0.12, 0.38, t) * (1.0 - smoothstep(0.38, 0.55, t))
	y = WHEEL_Y + 0.055
	y += H * 0.22 * nose
	y += H * 0.42 * hood
	y += H * 0.52 * cabin
	y -= H * 0.10 * smoothstep(0.88, 1.0, t)
	return y


def dominus_belly_height(z: float, x_norm: float) -> float:
	"""Dno nadwozia — spojler podwozia z tyłu, V-nose z przodu."""
	t = station_t(z)
	side = abs(x_norm)
	belly = WHEEL_Y + 0.048 + 0.022 * side
	belly += H * 0.06 * smoothstep(0.0, 0.18, t) * (1.0 - side)
	belly -= H * 0.04 * smoothstep(0.78, 1.0, t)
	return belly


def dominus_side_angle(z: float) -> float:
	"""Kąt boku — Dominus ma ostre, pochylone panele boczne."""
	t = station_t(z)
	base = math.radians(14)
	mid = smoothstep(0.25, 0.55, t) * math.radians(22)
	return base + mid


def cross_section(z: float, n_pts: int) -> list[tuple[float, float]]:
	"""
	Zamknięty kontur połówki przekroju (x>=0), od dołu-przodu do dołu-tyłu przez grzbiet.
	Pełny obwód = lustrzane odbicie X.
	"""
	hw = dominus_half_width(z)
	ridge = dominus_ridge_height(z)
	belly_c = dominus_belly_height(z, 0.0)
	belly_s = dominus_belly_height(z, 1.0)
	angle = dominus_side_angle(z)
	slope = math.tan(angle)

	pts: list[tuple[float, float]] = []

	# Dolna krawędź: przód → bok
	for i in range(n_pts // 4 + 1):
		u = i / (n_pts // 4)
		x = hw * u
		y = belly_c + (belly_s - belly_c) * u
		if u > 0.55:
			y += (u - 0.55) * slope * hw * 0.35
		pts.append((x, y))

	# Bok → ramie
	shoulder_x = hw * 0.92
	shoulder_y = belly_s + (ridge - belly_s) * 0.38 + slope * hw * 0.18
	pts.append((shoulder_x, shoulder_y))

	# Ramie → szczyt dachu
	roof_x = hw * 0.38
	pts.append((roof_x, ridge))
	pts.append((0.0, ridge * 1.01))

	return pts


def build_body_shell(paint: bpy.types.Material) -> bpy.types.Object:
	"""Loft skorupy — jedna ciągła powierzchnia, bez kostek."""
	n_z = 28
	n_ring = 20

	stations: list[list[Vector]] = []
	for iz in range(n_z + 1):
		z = -HL + (iz / n_z) * L
		half = cross_section(z, n_ring)
		ring: list[Vector] = []
		for x, y in half:
			ring.append(Vector((x, y, z)))
		for x, y in reversed(half[1:-1]):
			ring.append(Vector((-x, y, z)))
		stations.append(ring)

	bm = bmesh.new()
	grid_verts: list[list[bmesh.types.BMVert]] = []
	for ring in stations:
		row: list[bmesh.types.BMVert] = []
		for co in ring:
			row.append(bm.verts.new(co))
		grid_verts.append(row)

	for iz in range(n_z):
		r0 = grid_verts[iz]
		r1 = grid_verts[iz + 1]
		n = min(len(r0), len(r1))
		for i in range(n):
			j = (i + 1) % n
			try:
				bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
			except ValueError:
				pass

	# Zamknij przód i tył — stożkowaty nos, ścięty tył
	for ring, z_sign, z_pos in (
		(grid_verts[0], -1, -HL - 0.018),
		(grid_verts[-1], 1, HL + 0.008),
	):
		n = len(ring)
		center = bm.verts.new((0.0, ring[0].co.y * 0.72 if z_sign < 0 else ring[0].co.y * 0.88, z_pos))
		for i in range(n):
			j = (i + 1) % n
			try:
				bm.faces.new((ring[i], ring[j], center))
			except ValueError:
				pass

	bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
	mesh = bpy.data.meshes.new("body_mesh")
	bm.to_mesh(mesh)
	bm.free()
	mesh.validate()

	obj = bpy.data.objects.new("body", mesh)
	link(obj)
	assign_mat(obj, paint)

	b = obj.modifiers.new("Bevel", "BEVEL")
	b.width = 0.006
	b.segments = 2
	b.limit_method = "ANGLE"
	b.angle_limit = math.radians(40)
	s = obj.modifiers.new("Subsurf", "SUBSURF")
	s.levels = 2
	return obj


def add_mesh_cube(name: str, loc: tuple[float, float, float], scale: tuple[float, float, float],
                  rot: tuple[float, float, float] = (0, 0, 0)) -> bpy.types.Object:
	bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
	obj = bpy.context.active_object
	obj.name = name
	obj.scale = scale
	bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
	return obj


def add_bevel(obj: bpy.types.Object, width: float = 0.008, subsurf: int = 1) -> None:
	b = obj.modifiers.new("Bevel", "BEVEL")
	b.width = width
	b.segments = 2
	b.limit_method = "ANGLE"
	if subsurf > 0:
		s = obj.modifiers.new("Subsurf", "SUBSURF")
		s.levels = subsurf


def build_canopy(glass: bpy.types.Material) -> bpy.types.Object:
	z0 = L * 0.06
	obj = add_mesh_cube(
		"canopy",
		(0.0, H * 0.56, z0),
		(W * 0.34, H * 0.11, L * 0.14),
		(0.08, 0.0, 0.0),
	)
	assign_mat(obj, glass)
	add_bevel(obj, 0.012, 1)
	return obj


def build_hood_scoop(paint: bpy.types.Material) -> bpy.types.Object:
	obj = add_mesh_cube(
		"hood",
		(0.0, H * 0.36, -L * 0.18),
		(W * 0.22, H * 0.045, L * 0.22),
		(-0.06, 0.0, 0.0),
	)
	assign_mat(obj, paint)
	add_bevel(obj, 0.008, 1)
	return obj


def build_side_intake(side: str, paint: bpy.types.Material, dark: bpy.types.Material) -> bpy.types.Object:
	sx = -1.0 if side == "L" else 1.0
	x = sx * W * 0.335
	outer = add_mesh_cube(
		f"scoop_{side}",
		(x, H * 0.30, -L * 0.02),
		(0.055, H * 0.12, L * 0.24),
		(0.0, 0.0, sx * -0.28),
	)
	assign_mat(outer, paint)
	add_bevel(outer, 0.005, 0)

	inner = add_mesh_cube(
		f"scoop_{side}_inset",
		(x * 1.05, H * 0.285, -L * 0.02),
		(0.028, H * 0.07, L * 0.15),
		(0.0, 0.0, sx * -0.28),
	)
	assign_mat(inner, dark)
	inner.parent = outer
	return outer


def build_splitter(chrome: bpy.types.Material) -> bpy.types.Object:
	obj = add_mesh_cube(
		"splitter",
		(0.0, WHEEL_Y + 0.038, -HL + 0.04),
		(W * 0.54, 0.014, L * 0.11),
		(0.0, 0.0, 0.0),
	)
	assign_mat(obj, chrome)
	add_bevel(obj, 0.003, 0)
	return obj


def build_skirts(chrome: bpy.types.Material) -> bpy.types.Object:
	obj = add_mesh_cube(
		"side_skirt",
		(0.0, WHEEL_Y + 0.048, 0.0),
		(W * 0.52, 0.018, L * 0.68),
	)
	assign_mat(obj, chrome)
	add_bevel(obj, 0.003, 0)
	return obj


def build_diffuser(chrome: bpy.types.Material) -> bpy.types.Object:
	obj = add_mesh_cube(
		"diffuser",
		(0.0, WHEEL_Y + 0.042, HL - 0.05),
		(W * 0.46, 0.022, L * 0.09),
		(0.18, 0.0, 0.0),
	)
	assign_mat(obj, chrome)
	add_bevel(obj, 0.003, 0)
	return obj


def build_spoiler(paint: bpy.types.Material) -> bpy.types.Object:
	root = bpy.data.objects.new("spoiler", None)
	link(root)

	pylon_l = add_mesh_cube(
		"spoiler_pylon_L",
		(-W * 0.18, H * 0.48, HL - 0.04),
		(0.025, H * 0.14, 0.025),
	)
	assign_mat(pylon_l, paint)
	pylon_l.parent = root

	pylon_r = add_mesh_cube(
		"spoiler_pylon_R",
		(W * 0.18, H * 0.48, HL - 0.04),
		(0.025, H * 0.14, 0.025),
	)
	assign_mat(pylon_r, paint)
	pylon_r.parent = root

	wing = add_mesh_cube(
		"spoiler",
		(0.0, H * 0.58, HL - 0.02),
		(W * 0.54, 0.022, L * 0.07),
		(0.14, 0.0, 0.0),
	)
	assign_mat(wing, paint)
	add_bevel(wing, 0.005, 0)
	wing.parent = root
	return root


def build_headlight(name: str, x: float, glass: bpy.types.Material) -> bpy.types.Object:
	obj = add_mesh_cube(
		name,
		(x, H * 0.24, -HL + 0.05),
		(0.095, 0.038, 0.055),
		(0.0, 0.0, 0.0),
	)
	assign_mat(obj, glass)
	add_bevel(obj, 0.004, 0)
	return obj


def build_fender_arch(side: str, z: float, paint: bpy.types.Material) -> bpy.types.Object:
	sx = -1.0 if side == "L" else 1.0
	obj = add_mesh_cube(
		f"fender_{side}_{'F' if z > 0 else 'R'}",
		(sx * W * 0.38, WHEEL_Y + WHEEL_R * 0.72, z),
		(0.11, WHEEL_R * 0.55, WHEEL_R * 1.05),
		(0.0, 0.0, sx * 0.12),
	)
	assign_mat(obj, paint)
	add_bevel(obj, 0.008, 1)
	return obj


def build_wheel(name: str, x: float, z: float, rubber: bpy.types.Material, chrome: bpy.types.Material) -> bpy.types.Object:
	root = bpy.data.objects.new(name, None)
	link(root)
	root.location = (0.0, 0.0, 0.0)

	bpy.ops.mesh.primitive_cylinder_add(
		vertices=32,
		radius=WHEEL_R,
		depth=WHEEL_W,
		location=(x, WHEEL_Y, z),
		rotation=(math.pi / 2, 0.0, 0.0),
	)
	tire = bpy.context.active_object
	tire.name = f"{name}_tire"
	assign_mat(tire, rubber)
	tire.parent = root

	bpy.ops.mesh.primitive_cylinder_add(
		vertices=8,
		radius=WHEEL_R * 0.66,
		depth=WHEEL_W + 0.008,
		location=(x, WHEEL_Y, z),
		rotation=(math.pi / 2, 0.0, 0.0),
	)
	rim = bpy.context.active_object
	rim.name = f"{name}_rim"
	assign_mat(rim, chrome)
	rim.parent = root
	return root


def bottom_align(root: bpy.types.Object) -> None:
	bpy.context.view_layer.update()
	depsgraph = bpy.context.evaluated_depsgraph_get()
	min_y = float("inf")
	for obj in [root, *root.children_recursive]:
		eval_obj = obj.evaluated_get(depsgraph)
		if eval_obj.type != "MESH":
			continue
		for corner in eval_obj.bound_box:
			min_y = min(min_y, (eval_obj.matrix_world @ Vector(corner)).y)
	if min_y != float("inf"):
		root.location.y -= min_y


def export_glb(root: bpy.types.Object) -> None:
	OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
	bpy.ops.object.select_all(action="DESELECT")
	root.select_set(True)
	for c in root.children_recursive:
		c.select_set(True)
	bpy.ops.export_scene.gltf(
		filepath=str(OUT_GLB),
		export_format="GLB",
		use_selection=True,
		export_apply=True,
		export_yup=True,
		export_materials="EXPORT",
	)
	print(f"Zapisano: {OUT_GLB}")


def main() -> None:
	clear_scene()

	paint = mat_paint("CarPaint", (0.95, 0.42, 0.08))
	paint_dark = mat_dark("CarPaintDark", (0.48, 0.18, 0.04))
	chrome = mat_chrome("Chrome")
	glass = mat_glass("Glass")
	rubber = mat_rubber("Rubber")

	root = bpy.data.objects.new("octaneCar", None)
	link(root)

	parts = [
		build_body_shell(paint),
		build_hood_scoop(paint),
		build_canopy(glass),
		build_side_intake("L", paint, paint_dark),
		build_side_intake("R", paint, paint_dark),
		build_splitter(chrome),
		build_skirts(chrome),
		build_diffuser(chrome),
		build_spoiler(paint),
		build_headlight("headlight_L", -W * 0.31, glass),
		build_headlight("headlight_R", W * 0.31, glass),
		build_fender_arch("L", WZ_F, paint),
		build_fender_arch("R", WZ_F, paint),
		build_fender_arch("L", WZ_R, paint),
		build_fender_arch("R", WZ_R, paint),
	]

	for p in parts:
		p.parent = root

	for tag, x, z in (("FL", -WX, WZ_F), ("FR", WX, WZ_F), ("RL", -WX, WZ_R), ("RR", WX, WZ_R)):
		build_wheel(f"wheel_{tag}", x, z, rubber, chrome).parent = root

	bottom_align(root)

	# Weryfikacja wymiarów przed eksportem
	bpy.context.view_layer.update()
	depsgraph = bpy.context.evaluated_depsgraph_get()
	min_c = Vector((1e9, 1e9, 1e9))
	max_c = Vector((-1e9, -1e9, -1e9))
	for obj in root.children_recursive:
		eo = obj.evaluated_get(depsgraph)
		if eo.type != "MESH":
			continue
		for corner in eo.bound_box:
			w = eo.matrix_world @ Vector(corner)
			min_c.x = min(min_c.x, w.x)
			min_c.y = min(min_c.y, w.y)
			min_c.z = min(min_c.z, w.z)
			max_c.x = max(max_c.x, w.x)
			max_c.y = max(max_c.y, w.y)
			max_c.z = max(max_c.z, w.z)
	size = max_c - min_c
	print(f"bbox size X={size.x:.3f} Y={size.y:.3f} Z={size.z:.3f} (L={L}, W={W})")

	export_glb(root)


if __name__ == "__main__":
	main()
