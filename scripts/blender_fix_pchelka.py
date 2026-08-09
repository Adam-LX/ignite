"""Bake headlight lenses + roof flea into pchelka.glb (joined into body)."""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "site/media/pchelka.glb"
AVATAR = ROOT / "site/media/pchelka-avatar.png"
OUT_SITE = ROOT / "site/media/pchelka.glb"
OUT_GAME = ROOT / "public/assets/cars/pchelka.glb"


def world_bbox(obj: bpy.types.Object):
	mn = Vector((1e9, 1e9, 1e9))
	mx = Vector((-1e9, -1e9, -1e9))
	for c in obj.bound_box:
		w = obj.matrix_world @ Vector(c)
		mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
		mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
	return mn, mx


def clear_scene():
	bpy.ops.wm.read_factory_settings(use_empty=True)


def delete_helpers():
	for obj in list(bpy.data.objects):
		n = obj.name.lower()
		if n.startswith("headlight") or n.startswith("roof_") or n.startswith("viewer_"):
			bpy.data.objects.remove(obj, do_unlink=True)


def find_hole_rims(body: bpy.types.Object):
	mn, mx = world_bbox(body)
	sz = mx - mn
	front_z = mx.z
	dg = bpy.context.evaluated_depsgraph_get()
	NX, NY = 90, 70
	cells = []
	for ix in range(NX + 1):
		for iy in range(NY + 1):
			x = mn.x + (ix / NX) * sz.x
			y = mn.y + (iy / NY) * sz.y
			yf = (y - mn.y) / sz.y
			xf = abs(x - (mn.x + mx.x) * 0.5) / (sz.x * 0.5)
			if not (0.38 <= yf <= 0.82 and 0.55 <= xf <= 1.02):
				continue
			origin = Vector((x, y, front_z + 0.45))
			ok, loc, _n, _idx, _obj, _mat = bpy.context.scene.ray_cast(
				dg, origin, Vector((0, 0, -1)), distance=sz.z * 1.4
			)
			if not ok:
				cells.append((ix, iy, x, y, None, 9.0, True))
			else:
				depth = front_z - loc.z
				cells.append((ix, iy, x, y, loc.z, depth, depth > 0.28))

	amap = {(c[0], c[1]): c for c in cells}
	rim_pts: list[tuple[float, float, float]] = []
	for c in cells:
		if not c[6]:
			continue
		for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
			o = amap.get((c[0] + dx, c[1] + dy))
			if o and not o[6] and o[4] is not None:
				rim_pts.append((o[2], o[3], o[4]))

	holes = []
	for side in (-1, 1):
		pts = [p for p in rim_pts if p[0] * side > 0]
		if not pts:
			continue
		pts.sort(key=lambda p: (-p[2], -abs(p[0])))
		top = pts[: max(12, len(pts) // 4)]
		cx = sum(p[0] for p in top) / len(top)
		cy = sum(p[1] for p in top) / len(top)
		cz = sum(p[2] for p in top) / len(top)
		holes.append((cx, cy, cz, side))
		print(f"HOLE side={side} center=({cx:.4f},{cy:.4f},{cz:.4f}) n={len(top)}")
	return holes, mn, mx


def make_lens(name: str, center: Vector, radius: float):
	bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=center, segments=28, ring_count=16)
	obj = bpy.context.active_object
	obj.name = name
	obj.scale = (1.0, 1.0, 0.4)
	bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
	mat = bpy.data.materials.new(name + "_mat")
	mat.use_nodes = True
	nt = mat.node_tree
	nt.nodes.clear()
	out = nt.nodes.new("ShaderNodeOutputMaterial")
	emis = nt.nodes.new("ShaderNodeEmission")
	emis.inputs["Color"].default_value = (0.55, 0.92, 1.0, 1.0)
	emis.inputs["Strength"].default_value = 14.0
	nt.links.new(emis.outputs["Emission"], out.inputs["Surface"])
	obj.data.materials.clear()
	obj.data.materials.append(mat)
	return obj


def make_roof_badge(body: bpy.types.Object, mn: Vector, mx: Vector):
	sz = mx - mn
	dg = bpy.context.evaluated_depsgraph_get()
	cx = (mn.x + mx.x) * 0.5
	cz = (mn.z + mx.z) * 0.5 - sz.z * 0.085
	best_loc = Vector((cx, mx.y, cz))
	best_n = Vector((0, 1, 0))
	best_y = -1e9
	for dx in range(-3, 4):
		for dz in range(-3, 4):
			ox = cx + (dx / 3) * sz.x * 0.04
			oz = cz + (dz / 3) * sz.z * 0.04
			ok, loc, n, _i, _o, _m = bpy.context.scene.ray_cast(
				dg, Vector((ox, mx.y + 0.6, oz)), Vector((0, -1, 0)), distance=sz.y * 1.8
			)
			if not ok or n is None or n.y < 0.85:
				continue
			if loc.y > best_y:
				best_y = loc.y
				best_loc = loc.copy()
				best_n = n.normalized()
	pos = best_loc + best_n * 0.0015
	r = max(0.11, min(sz.x, sz.z) * 0.24)

	# White backing disc (border)
	bpy.ops.mesh.primitive_circle_add(vertices=64, radius=r * 1.1, fill_type="NGON", location=pos)
	ring = bpy.context.active_object
	ring.name = "roof_ring"
	ring.rotation_euler = (math.radians(-90), 0, 0)
	bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
	rmat = bpy.data.materials.new("roof_ring_mat")
	rmat.use_nodes = True
	nt = rmat.node_tree
	nt.nodes.clear()
	out = nt.nodes.new("ShaderNodeOutputMaterial")
	emis = nt.nodes.new("ShaderNodeEmission")
	emis.inputs["Color"].default_value = (1, 1, 1, 1)
	emis.inputs["Strength"].default_value = 1.4
	nt.links.new(emis.outputs["Emission"], out.inputs["Surface"])
	ring.data.materials.append(rmat)

	# Avatar disc on top
	bpy.ops.mesh.primitive_circle_add(
		vertices=64, radius=r, fill_type="NGON", location=pos + best_n * 0.0012
	)
	disc = bpy.context.active_object
	disc.name = "roof_avatar"
	disc.rotation_euler = (math.radians(-90), 0, 0)
	bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
	# Ensure UVs exist for circle
	bpy.ops.object.mode_set(mode="EDIT")
	bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.001)
	bpy.ops.object.mode_set(mode="OBJECT")

	img = bpy.data.images.load(str(AVATAR))
	mat = bpy.data.materials.new("roof_avatar_mat")
	mat.use_nodes = True
	try:
		mat.blend_method = "CLIP"
	except Exception:
		pass
	nt = mat.node_tree
	nt.nodes.clear()
	out = nt.nodes.new("ShaderNodeOutputMaterial")
	bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
	tex = nt.nodes.new("ShaderNodeTexImage")
	tex.image = img
	nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
	if "Alpha" in bsdf.inputs:
		nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
	bsdf.inputs["Roughness"].default_value = 0.5
	if "Emission Color" in bsdf.inputs:
		bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
		bsdf.inputs["Emission Strength"].default_value = 0.2
	nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
	disc.data.materials.append(mat)
	print(f"ROOF at ({pos.x:.4f},{pos.y:.4f},{pos.z:.4f})")
	return disc, ring


def join_to_body(body: bpy.types.Object, extras: list[bpy.types.Object]):
	bpy.ops.object.select_all(action="DESELECT")
	for o in extras:
		o.select_set(True)
	body.select_set(True)
	bpy.context.view_layer.objects.active = body
	bpy.ops.object.join()


def export_glb(path: Path):
	path.parent.mkdir(parents=True, exist_ok=True)
	bpy.ops.export_scene.gltf(
		filepath=str(path),
		export_format="GLB",
		use_selection=False,
		export_apply=True,
		export_yup=True,
	)
	print("OK wrote", path, "bytes", path.stat().st_size)


def main():
	clear_scene()
	bpy.ops.import_scene.gltf(filepath=str(GLB))
	delete_helpers()
	body = bpy.data.objects.get("body")
	if not body:
		print("ERROR: no body", file=sys.stderr)
		sys.exit(1)

	holes, mn, mx = find_hole_rims(body)
	if len(holes) < 2:
		print("ERROR: expected 2 holes, got", holes, file=sys.stderr)
		sys.exit(2)

	sz = mx - mn
	radius = max(0.03, min(sz.x, sz.y) * 0.058)
	extras = []
	for cx, cy, cz, side in holes:
		center = Vector((cx, cy, cz + 0.008))
		extras.append(make_lens(f"headlight_{'L' if side < 0 else 'R'}", center, radius))

	disc, ring = make_roof_badge(body, mn, mx)
	extras.extend([ring, disc])
	join_to_body(body, extras)
	export_glb(OUT_SITE)
	export_glb(OUT_GAME)
	print("DONE", holes)


if __name__ == "__main__":
	main()
