--!nonstrict
--[[
	Content.luau - every number that shapes a fight.

	This is the file to edit.  Nothing here knows how a figure is drawn or how
	a wave is spawned; it only says what exists and how hard it hits.  The same
	tables feed the web build in js/world.js and js/models.js, so a balance pass
	can be done once and copied across.

	Three things live here:

	  profiles  a body plan.  A profile reskins the one generated rig rather
	            than needing a new model, so ten monsters out of one skeleton.
	  species   a creature: a profile, combat numbers, colours, decorations.
	  stages    an arena, a sky, and a list of waves ending in a boss.
]]

local Content = {}

-- --------------------------------------------------------------------------
-- the player
-- --------------------------------------------------------------------------
Content.player = {
	health = 120,
	walkSpeed = 22,
	jumpHeight = 8.5,
	sprintMultiplier = 1.35,   -- held shift; applied on the client only

	-- the three-hit combo.  Each landed hit inside the window adds a step of
	-- damage and a little forward shove, which is what makes melee feel like
	-- it has weight instead of being three separate pokes.
	combo = {
		damage = 9,
		reach = 8.5,          -- studs, measured from the torso
		arc = 110,            -- degrees, centred on where the camera looks
		windup = 0.10,
		recover = 0.22,
		window = 0.75,        -- how long a hit stays "open" for the next one
		chain = { 1.0, 1.15, 1.6 },
		lunge = 7,            -- studs/sec shove toward the target
		knockback = 9,
	},

	-- the ranged special on a cooldown: a beam that pierces the line it fires
	beam = {
		damage = 26,
		range = 90,
		width = 3.5,
		cooldown = 7,
	},

	-- the roll: brief, invulnerable, on a cooldown
	roll = {
		distance = 14,
		time = 0.45,
		cooldown = 2.2,
		invulnerable = 0.32,
	},

	respawn = 3.5,
}

-- --------------------------------------------------------------------------
-- body plans
--
-- `girth` and `height` scale the generated rig; `extras` bolt decorations onto
-- named joints.  Extra offsets are in model space with Y up, -Z forward and +X
-- to the creature's right, so they land the same way round whatever the source
-- .glb faced (see tools/glb_to_roblox.py and docs/ROBLOX.md).
-- --------------------------------------------------------------------------
local function horn(side, up, spread)
	-- `cone` is a roblox Cylinder, whose length runs along its X axis; the
	-- runtime lays it down along Y, so size reads (length, girth, girth)
	return {
		joint = "Head", kind = "cone",
		at = Vector3.new(0.30 * side, 0.42 + (up or 0), -0.05),
		size = Vector3.new(0.85, 0.20, 0.20),
		tilt = CFrame.fromEulerAnglesXYZ(math.rad(-16), 0, math.rad(-20 * (spread or side))),
		material = Enum.Material.SmoothPlastic, shade = "trim",
	}
end

Content.profiles = {
	-- small and quick: a nuisance alone, a problem in fives
	skirmisher = {
		girth = 0.85, height = 0.86, hull = "hull", trim = "trim",
		extras = {
			{ joint = "Head", kind = "ball", at = Vector3.new(0, 0.06, -0.30),
			  size = Vector3.new(0.22, 0.22, 0.22), shade = "glow",
			  material = Enum.Material.Neon },
		},
	},

	-- the baseline: shoulders, fists, no nonsense
	brawler = {
		girth = 1.18, height = 1.02,
		extras = {
			{ joint = "spine_03", kind = "plate", at = Vector3.new(0, 0.34, 0.10),
			  size = Vector3.new(0.55, 0.30, 0.5), shade = "trim" },
			horn(1, 0, 1), horn(-1, 0, 1),
		},
	},

	-- heavy: slow, wide, hard to stagger
	brute = {
		girth = 1.55, height = 1.22,
		extras = {
			{ joint = "spine_02", kind = "spikes", count = 4, spacing = 0.34,
			  at = Vector3.new(0, 0.42, 0.08), size = Vector3.new(0.20, 0.55, 0.30),
			  shade = "trim" },
			horn(1, 0.1, 1.4), horn(-1, 0.1, 1.4),
			{ joint = "thigh_l", kind = "plate", at = Vector3.new(0.28, 0, 0),
			  size = Vector3.new(0.26, 0.9, 0.9), shade = "trim" },
			{ joint = "thigh_r", kind = "plate", at = Vector3.new(-0.28, 0, 0),
			  size = Vector3.new(0.26, 0.9, 0.9), shade = "trim" },
		},
	},

	-- armoured: metal, a crest, a tail that swings
	armoured = {
		girth = 1.35, height = 1.12,
		extras = {
			{ joint = "Head", kind = "crest", at = Vector3.new(0, 0.46, 0.06),
			  size = Vector3.new(0.12, 0.55, 0.85), shade = "trim",
			  material = Enum.Material.Metal },
			{ joint = "pelvis", kind = "tail", count = 4, step = 0.62,
			  at = Vector3.new(0, 0.05, 0.30), size = Vector3.new(0.34, 0.34, 0.62),
			  shade = "trim" },
			{ joint = "upperarm_l", kind = "plate", at = Vector3.new(0.20, 0, 0),
			  size = Vector3.new(0.2, 0.55, 0.55), shade = "trim",
			  material = Enum.Material.Metal },
			{ joint = "upperarm_r", kind = "plate", at = Vector3.new(-0.20, 0, 0),
			  size = Vector3.new(0.2, 0.55, 0.55), shade = "trim",
			  material = Enum.Material.Metal },
		},
	},

	-- winged: light, fast, opens from above
	flyer = {
		girth = 0.95, height = 1.0,
		extras = {
			{ joint = "spine_03", kind = "wing", side = 1,
			  at = Vector3.new(0.55, 0.25, 0.25), size = Vector3.new(2.6, 0.14, 1.3),
			  shade = "trim" },
			{ joint = "spine_03", kind = "wing", side = -1,
			  at = Vector3.new(-0.55, 0.25, 0.25), size = Vector3.new(2.6, 0.14, 1.3),
			  shade = "trim" },
			{ joint = "Head", kind = "crest", at = Vector3.new(0, 0.40, 0.10),
			  size = Vector3.new(0.10, 0.30, 0.6), shade = "glow",
			  material = Enum.Material.Neon },
		},
	},
}

-- --------------------------------------------------------------------------
-- the roster
--
-- speed is studs per second, reach is studs, windup is how long the tell lasts
-- before the hit lands.  A windup under a quarter second reads as unfair, so
-- the fast ones hit softly and the slow ones hit hard.
-- --------------------------------------------------------------------------
Content.species = {
	jamila   = { name = "Jamila",   profile = "skirmisher",
	             hull = Color3.fromRGB(118, 168, 96),  trim = Color3.fromRGB(196, 226, 132),
	             health = 42,  speed = 16, damage = 7,  windup = 0.30, reach = 7,
	             cooldown = 1.0, bounty = 1 },
	bemular  = { name = "Bemular",  profile = "brawler",
	             hull = Color3.fromRGB(126, 132, 190), trim = Color3.fromRGB(226, 226, 240),
	             health = 78,  speed = 13, damage = 11, windup = 0.40, reach = 8,
	             cooldown = 1.3, bounty = 2 },
	redking  = { name = "Red King", profile = "brute",
	             hull = Color3.fromRGB(186, 92, 74),   trim = Color3.fromRGB(240, 196, 150),
	             health = 210, speed = 11, damage = 19, windup = 0.62, reach = 10,
	             cooldown = 1.6, bounty = 6, boss = true },
	birdon   = { name = "Birdon",   profile = "flyer",
	             hull = Color3.fromRGB(214, 152, 62),  trim = Color3.fromRGB(248, 226, 160),
	             health = 64,  speed = 18, damage = 9,  windup = 0.26, reach = 7,
	             cooldown = 0.9, bounty = 2 },
	baltan   = { name = "Baltan",   profile = "flyer",
	             hull = Color3.fromRGB(96, 148, 168),  trim = Color3.fromRGB(178, 232, 240),
	             health = 70,  speed = 17, damage = 10, windup = 0.30, reach = 8,
	             cooldown = 1.0, bounty = 2 },
	eleking  = { name = "Eleking",  profile = "armoured",
	             hull = Color3.fromRGB(96, 128, 108),  trim = Color3.fromRGB(206, 236, 180),
	             health = 128, speed = 12, damage = 14, windup = 0.48, reach = 9,
	             cooldown = 1.4, bounty = 3 },
	golza    = { name = "Golza",    profile = "brute",
	             hull = Color3.fromRGB(150, 106, 84),  trim = Color3.fromRGB(238, 202, 158),
	             health = 172, speed = 12, damage = 17, windup = 0.55, reach = 9,
	             cooldown = 1.5, bounty = 4 },
	kingjoe  = { name = "King Joe", profile = "armoured",
	             hull = Color3.fromRGB(120, 124, 134), trim = Color3.fromRGB(226, 196, 84),
	             health = 190, speed = 10, damage = 18, windup = 0.58, reach = 10,
	             cooldown = 1.7, bounty = 5 },
	gomora   = { name = "Gomora",   profile = "armoured",
	             hull = Color3.fromRGB(158, 118, 96),  trim = Color3.fromRGB(246, 222, 186),
	             health = 205, speed = 13, damage = 20, windup = 0.56, reach = 10,
	             cooldown = 1.5, bounty = 6, boss = true },
	zetton   = { name = "Zetton",   profile = "armoured",
	             hull = Color3.fromRGB(78, 74, 92),    trim = Color3.fromRGB(236, 108, 92),
	             health = 260, speed = 12, damage = 22, windup = 0.60, reach = 10,
	             cooldown = 1.4, bounty = 8, boss = true },
}

-- --------------------------------------------------------------------------
-- stages
--
-- a wave is a list of { species, count, from } - `from` is a compass point, so
-- a wave can be told to arrive from one side instead of surrounding you.
-- The last stage repeats the boss with everything else thrown in.
-- --------------------------------------------------------------------------
Content.stages = {
	{
		name = "Landing Zone",
		sky = Color3.fromRGB(126, 152, 196),
		ground = Color3.fromRGB(104, 108, 118),
		trim = Color3.fromRGB(206, 176, 92),
		radius = 150,
		waves = {
			{ { species = "jamila", count = 3 } },
			{ { species = "jamila", count = 3 }, { species = "bemular", count = 1 } },
			{ { species = "bemular", count = 2 }, { species = "birdon", count = 2, from = "east" } },
		},
		boss = "bemular",
	},
	{
		name = "Ruin Bay",
		sky = Color3.fromRGB(122, 138, 168),
		ground = Color3.fromRGB(92, 96, 104),
		trim = Color3.fromRGB(96, 168, 196),
		radius = 160,
		waves = {
			{ { species = "baltan", count = 3 } },
			{ { species = "eleking", count = 2 }, { species = "jamila", count = 2 } },
			{ { species = "eleking", count = 3 }, { species = "birdon", count = 2, from = "west" } },
		},
		boss = "redking",
	},
	{
		name = "Ash Plateau",
		sky = Color3.fromRGB(148, 118, 108),
		ground = Color3.fromRGB(112, 92, 84),
		trim = Color3.fromRGB(232, 148, 72),
		radius = 170,
		waves = {
			{ { species = "golza", count = 2 }, { species = "jamila", count = 3 } },
			{ { species = "kingjoe", count = 1 }, { species = "bemular", count = 3 } },
			{ { species = "kingjoe", count = 2 }, { species = "baltan", count = 3, from = "north" } },
		},
		boss = "gomora",
	},
	{
		name = "Deep Orbit",
		sky = Color3.fromRGB(48, 46, 74),
		ground = Color3.fromRGB(62, 60, 82),
		trim = Color3.fromRGB(232, 92, 96),
		radius = 185,
		waves = {
			{ { species = "zetton", count = 1 }, { species = "baltan", count = 3 } },
			{ { species = "gomora", count = 1 }, { species = "eleking", count = 2 } },
			{ { species = "zetton", count = 1 }, { species = "gomora", count = 1 } },
		},
		boss = "zetton",
	},
}

-- --------------------------------------------------------------------------
-- clip slots
--
-- Figure:play accepts either a real clip name or one of these slots, so the
-- game logic never mentions a clip by name.  These are the slots for the rig
-- generated from assets/models/anim-ual.glb; regenerate from another .glb and
-- this table has to follow it (tools/glb_to_roblox.py prints what it wrote).
-- --------------------------------------------------------------------------
Content.clips = {
	idle = "Idle_Loop",
	walk = "Walk_Loop",
	run = "Jog_Fwd_Loop",
	sprint = "Sprint_Loop",
	jump = "Jump_Start",
	air = "Jump_Loop",
	land = "Jump_Land",
	atk1 = "Punch_Jab",
	atk2 = "Punch_Cross",
	slash = "Sword_Attack",
	beam = "Spell_Simple_Shoot",
	hit = "Hit_Chest",
	hitHead = "Hit_Head",
	death = "Death01",
	roll = "Roll",
}

-- --------------------------------------------------------------------------
-- helpers
-- --------------------------------------------------------------------------
Content.compass = {
	north = Vector3.new(0, 0, -1),
	south = Vector3.new(0, 0, 1),
	east = Vector3.new(1, 0, 0),
	west = Vector3.new(-1, 0, 0),
}

function Content.speciesOf(key)
	local s = Content.species[key]
	assert(s, "Content.species has no entry for '" .. tostring(key) .. "'")
	return s
end

function Content.stageCount()
	return #Content.stages
end

function Content.stageAt(index)
	return Content.stages[((index - 1) % #Content.stages) + 1]
end

return Content
