--!nonstrict
--[[
	Stage.luau - throws up an arena out of parts.

	The web build builds nine levels from dado blocks and shipping containers;
	this does the same job with Roblox primitives so a stage costs nothing to
	author.  It reads Content.stages, so reskinning a level means editing a
	colour and a radius, not a model.

	Returns a handle rather than a bare model so the game can ask where to spawn
	things without knowing how the arena was made:

		local arena = Stage.build(1)
		arena.spawnPoint(index)     -- a rim position to drop a monster on
		arena:destroy()
]]

local Lighting = game:GetService("Lighting")
local Content = require(script.Parent.Content)

local Stage = {}

local function block(parent, name, size, cf, color, material, collide)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.Size = size
	part.CFrame = cf
	part.Color = color
	part.Material = material or Enum.Material.Concrete
	part.CanCollide = collide ~= false
	part.CanQuery = collide ~= false
	part.CanTouch = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

local function dress(spec)
	Lighting.Ambient = Color3.fromRGB(96, 100, 112)
	Lighting.OutdoorAmbient = spec.sky
	Lighting.Brightness = 2.2
	Lighting.ClockTime = 15.5
	Lighting.FogColor = spec.sky
	Lighting.FogEnd = spec.radius * 5
	Lighting.FogStart = spec.radius * 1.1
	Lighting.GlobalShadows = true
end

function Stage.build(index)
	local spec = Content.stageAt(index)
	local radius = spec.radius or 150

	local baseplate = workspace:FindFirstChild("Baseplate")
	if baseplate then baseplate:Destroy() end
	local old = workspace:FindFirstChild("Arena")
	if old then old:Destroy() end

	local model = Instance.new("Model")
	model.Name = "Arena"

	dress(spec)

	-- the floor
	block(model, "Ground", Vector3.new(radius * 2, 6, radius * 2),
		CFrame.new(0, -3, 0), spec.ground, Enum.Material.Slate, true)

	-- a rim so nothing walks off the edge, raised enough to read as a wall
	local segments = 28
	for i = 1, segments do
		local angle = (i / segments) * math.pi * 2
		local height = 16 + (i % 3) * 4
		block(model, "Wall", Vector3.new(radius * 0.34, height, 5),
			CFrame.new(math.cos(angle) * radius, height * 0.5 - 1, math.sin(angle) * radius)
				* CFrame.Angles(0, -angle, 0),
			spec.ground:Lerp(Color3.new(0, 0, 0), 0.25), Enum.Material.Slate, true)
	end

	-- clutter: cover to fight around, and something to break line of sight
	local clutter = 16
	for i = 1, clutter do
		local angle = math.random() * math.pi * 2
		local reach = radius * (0.22 + math.random() * 0.5)
		local size = Vector3.new(4 + math.random() * 10, 6 + math.random() * 20, 4 + math.random() * 10)
		block(model, "Cover", size,
			CFrame.new(math.cos(angle) * reach, size.Y * 0.5 - 1, math.sin(angle) * reach)
				* CFrame.Angles(0, math.random() * math.pi, 0),
			spec.ground:Lerp(spec.trim, math.random() * 0.35), Enum.Material.CorrodedMetal, true)
	end

	-- something to look at: a lit stack in the middle of the arena
	local beacon = block(model, "Beacon", Vector3.new(6, 26, 6), CFrame.new(0, 12, 0),
		spec.trim, Enum.Material.Neon, true)
	local light = Instance.new("PointLight")
	light.Color = spec.trim
	light.Range = 60
	light.Brightness = 3
	light.Parent = beacon

	model.Parent = workspace

	local handle = {
		model = model,
		spec = spec,
		radius = radius,
		centre = Vector3.new(0, 0, 0),
	}

	-- rim positions, evenly spaced but jittered, so a wave does not arrive in a
	-- perfect ring - and so a monster never spawns in the same spot twice
	function handle.spawnPoint(index, side)
		local count = 24
		local s = (index or 1) - 1
		local angle
		if side then
			local dir = Content.compass[side] or Vector3.new(0, 0, -1)
			local base = math.atan2(-dir.X, -dir.Z)
			angle = base + ((s % 5) - 2) * 0.18
		else
			angle = (s / count) * math.pi * 2 + (math.random() - 0.5) * 0.2
		end
		local reach = radius * 0.86
		return CFrame.new(math.cos(angle) * reach, 0, math.sin(angle) * reach)
	end

	-- players come in near the middle, spread out so two of them never land in
	-- the same spot and shove each other off the beacon
	function handle.spawnPlayer(index)
		local angle = ((index or 1) - 1) * 2.1 + 0.6
		local reach = radius * 0.18
		return CFrame.new(math.cos(angle) * reach, 5, math.sin(angle) * reach)
	end

	function handle:destroy()
		model:Destroy()
	end

	return handle
end

return Stage
