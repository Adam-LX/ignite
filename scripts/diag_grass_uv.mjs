#!/usr/bin/env node
/** Diagnostyka UV boiska — uruchom: nix develop -c node scripts/diag_grass_uv.mjs */
import * as THREE from "three";

const FIELD_WIDTH = 150;
const FIELD_LENGTH = 240;
const hw = FIELD_WIDTH / 2;
const hl = FIELD_LENGTH / 2;
const r = 12;
const GRASS_TILE_METERS = 4;

const shape = new THREE.Shape();
shape.moveTo(-hw + r, -hl);
shape.lineTo(hw - r, -hl);
shape.quadraticCurveTo(hw, -hl, hw, -hl + r);
shape.lineTo(hw, hl - r);
shape.quadraticCurveTo(hw, hl, hw - r, hl);
shape.lineTo(-hw + r, hl);
shape.quadraticCurveTo(-hw, hl, -hw, hl - r);
shape.lineTo(-hw, -hl + r);
shape.quadraticCurveTo(-hw, -hl, -hw + r, -hl);

const geo = new THREE.ShapeGeometry(shape);
geo.rotateX(-Math.PI / 2);

const pos = geo.attributes.position;
const uv = geo.attributes.uv;
let minU = Infinity,
	maxU = -Infinity,
	minV = Infinity,
	maxV = -Infinity;
for (let i = 0; i < pos.count; i++) {
	const x = pos.getX(i);
	const z = pos.getZ(i);
	const u = x / GRASS_TILE_METERS;
	const v = -z / GRASS_TILE_METERS;
	uv.setXY(i, u, v);
	minU = Math.min(minU, u);
	maxU = Math.max(maxU, u);
	minV = Math.min(minV, v);
	maxV = Math.max(maxV, v);
}

console.log("vertices", pos.count, "hasUV", !!uv);
console.log("UV range u:", minU.toFixed(2), maxU.toFixed(2), "v:", minV.toFixed(2), maxV.toFixed(2));
if (maxU - minU < 1) console.error("BUG: UV span too small — flat texture");
