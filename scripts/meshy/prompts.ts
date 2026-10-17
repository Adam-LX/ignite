/** Prompty Meshy — arena full-throttle (text-to-image / text-to-3d). */

export const MESHY_TEXTURE_PROMPTS = {
	grass:
		"Photorealistic seamless soccer stadium turf texture, lush natural green grass, " +
		"top-down orthographic view, fine organic blade detail, subtle wear, " +
		"uniform coverage, no grid lines, no squares, no black gaps, no logo, PBR albedo",
	wall:
		"Seamless tileable futuristic stadium glass wall panel texture, dark navy blue, " +
		"subtle cyan neon grid lines, holographic glass, game texture, flat, no text",
	wallCity:
		"Seamless tileable cyberpunk megacity skyline texture, dense tower window lights, " +
		"cyan and orange glow, atmospheric smog, horizontal strip, dark silhouette, " +
		"game environment backdrop, no text, no stadium",
	banner:
		"Seamless tileable LED stadium banner panel texture, dark carbon fiber, " +
		"cyan orange neon racing stripes, holographic display, game texture, no text",
	bannerBlue:
		"Seamless tileable LED stadium banner, dark carbon, dominant cyan electric blue " +
		"neon stripes, holographic racing display, game texture, no text",
	bannerOrange:
		"Seamless tileable LED stadium banner, dark carbon, dominant orange amber " +
		"neon stripes, holographic racing display, game texture, no text",
	ceiling:
		"Seamless tileable futuristic stadium ceiling panel texture, dark navy carbon, " +
		"cyan orange holographic LED truss arrays, industrial sci-fi roof panels, " +
		"volumetric light strips, game texture, flat, no text",
	rampBlue:
		"Seamless tileable futuristic stadium ramp surface, frosted cyan glass panels, " +
		"electric blue underglow, brushed metal edges, game texture, no text",
	rampOrange:
		"Seamless tileable futuristic stadium ramp surface, heated orange carbon fiber, " +
		"amber neon underglow, brushed metal edges, game texture, no text",
	goalNet:
		"Seamless tileable holographic soccer goal net texture, hex wire grid, cyan glow, " +
		"dark void alpha holes, game texture, high contrast, no text",
	pitchCenter:
		"Top-down stadium center circle decal texture, holographic cyan and orange paint " +
		"on grass, worn turf lines, esports pitch marking, transparent background edges, no text",
	goalBurstBlue:
		"Radial cyberpunk stadium goal explosion VFX sprite, electric cyan blue energy burst, " +
		"white hot core, neon shockwave filaments, dark transparent edges, game particle texture, no text",
	goalBurstOrange:
		"Radial cyberpunk stadium goal explosion VFX sprite, amber orange energy burst, " +
		"white hot core, neon shockwave filaments, dark transparent edges, game particle texture, no text",
} as const;

export const MESHY_SKY_PROMPTS = {
	sky:
		"Cinematic cyberpunk night sky, volumetric neon fog, magenta purple aurora clouds, " +
		"cyan light pillars piercing smog, glowing toxic clouds, synthwave atmosphere, " +
		"stars and distant holographic beams in upper sky, soft photographic haze, " +
		"wide panoramic view, no buildings in foreground, no stadium, no text",
	skyHorizon:
		"Endless cyberpunk megacity at night, aerial view of millions of tower lights, " +
		"cyan blue and blood orange window glow, soft atmospheric smog, distant skyline, " +
		"volumetric fog between skyscrapers, cinematic wide horizon, no stadium no grass " +
		"no cars no people, photographic game environment",
} as const;

export const MESHY_MODEL_PROMPTS = {
	grassTuft:
		"Sci-fi futuristic stadium grass tuft, dense green blades, high quality video game foliage asset, " +
		"low-poly, gltf format",
	menuTile:
		"Cyberpunk sci-fi UI hud panel frame, futuristic electronic display borders, matte dark carbon, " +
		"glowing neon line accents, flat tech plate, gltf format",
	goal:
		"Sci-fi esports stadium soccer goal posts, futuristic stadium net frame, heavy industrial " +
		"metal chamfered chassis, cyberpunk neon glowing highlights, professional video game asset, " +
		"clean topology, low-poly, hard-surface moddable geometry, gltf format",
	stadiumTrim:
		"Cyberpunk stadium border trim, futuristic sci-fi tech panel, neon glowing light lines, " +
		"dark carbon fiber texture, professional video game asset, hard-surface modular prop, gltf format",
	pylon:
		"Futuristic stadium light pylon tower, stacked neon energy rings, carbon fiber mast, " +
		"crown spotlight array, game-ready 3D asset, vertical, clean geometry, no cables",
	powerUpMagnet:
		"Futuristic purple magnet power-up pickup, floating horseshoe magnet, neon glow, " +
		"game-ready 3D icon, clean solid geometry",
	powerUpPlunger:
		"Futuristic cyan plunger suction power-up pickup, stylized vacuum plunger, neon glow, " +
		"game-ready 3D icon, clean solid geometry",
	powerUpHaymaker:
		"Futuristic orange boxing glove haymaker power-up pickup, neon glow, " +
		"game-ready 3D icon, clean solid geometry",
	powerUpSpikes:
		"Futuristic red spike trap power-up pickup, radial metal spikes sphere, neon glow, " +
		"game-ready 3D icon, clean solid geometry",
} as const;

export const MESHY_CAR_PROMPTS = {
	blue:
		"Futuristic rocket league cyberpunk car, proper 3D vehicle proportions with height and volume, " +
		"not flat or squashed, brushed chrome panels, cyan neon LED trim, carbon fiber, game-ready PBR",
	orange:
		"Futuristic rocket league cyberpunk car, proper 3D vehicle proportions with height and volume, " +
		"not flat or squashed, brushed chrome panels, orange amber neon LED trim, carbon fiber, game-ready PBR",
} as const;

export const MESHY_BALL_PROMPTS = {
	albedo:
		"Futuristic cyber sports soccer ball surface texture, classic 32-panel football pattern, " +
		"intricate sci-fi mechanical grooved lines between panels, glowing neon emissive channels, " +
		"brushed titanium and matte carbon fiber, rocket league style, PBR albedo, flat lighting, no background",
	ball3d:
		"Rocket league style cyberpunk soccer ball, geometric 32-panel high-contrast football structure, " +
		"intense matte black carbon fiber texture paired with bright white polished futuristic grip plating, " +
		"glowing neon cyan status lines in creases, photorealistic hard-surface sports game asset, " +
		"low-poly, gltf format",
} as const;
