--!nonstrict
--[[
	Effects.luau - the visual grammar.

	Every effect is a short-lived anchored part that tweens itself out and is
	cleaned up by Debris, so a forty minute fight cannot leak a single instance.
	They run on the server for the simple reason that a starter should have one
	authority; if you later move the monsters to the clients, move this too and
	fire it from the same remote that carries the hit.

	Everything takes a position and a colour, so a species can own its palette
	without this module knowing what a species is.
]]

local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")

local Effects = {}

local function part(props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.Neon
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Size = Vector3.new(1, 1, 1)
	p.Transparency = 0
	p.Parent = workspace
	for k, v in pairs(props) do p[k] = v end
	return p
end

local function tween(p, spec, life)
	TweenService:Create(p, TweenInfo.new(spec.time or life, spec.style or Enum.EasingStyle.Quad,
		spec.dir or Enum.EasingDirection.Out), spec.to):Play()
	Debris:AddItem(p, life + 0.15)
end

-- --------------------------------------------------------------------------
-- impacts
-- --------------------------------------------------------------------------

-- a fist meeting a chest: a bright flash, a few shards, a ring on the ground
function Effects.hit(position, color, scale)
	scale = scale or 1
	local flash = part({ Shape = Enum.PartType.Ball, Color = color,
		Size = Vector3.new(scale * 1.4, scale * 1.4, scale * 1.4), Position = position })
	tween(flash, { to = { Transparency = 1, Size = Vector3.new(scale * 3.2, scale * 3.2, scale * 3.2) } }, 0.18)

	for i = 1, 5 do
		local shard = part({ Color = color, Size = Vector3.new(0.22, 0.22, 0.9) * scale,
			CFrame = CFrame.new(position) * CFrame.Angles(math.random() * 6, math.random() * 6, 0) })
		local dir = (CFrame.Angles(math.random() * 6.28, math.random() * 6.28, 0).LookVector
			* (5 + math.random() * 7) * scale)
		shard.CFrame = CFrame.new(position + dir.Unit * -0.4) * shard.CFrame.Rotation
		tween(shard, { time = 0.22, to = {
			CFrame = CFrame.new(position + dir * 0.7) * shard.CFrame.Rotation,
			Transparency = 1,
		} }, 0.28)
	end

	local light = Instance.new("PointLight")
	light.Color = color
	light.Range = 14 * scale
	light.Brightness = 6
	light.Parent = flash
	Debris:AddItem(light, 0.14)
end

-- a shockwave on the ground: the read for "something heavy landed"
function Effects.shock(position, color, radius)
	local disc = part({ Shape = Enum.PartType.Cylinder, Color = color,
		CFrame = CFrame.new(position) * CFrame.Angles(0, 0, math.rad(90)),
		Size = Vector3.new(0.25, radius * 0.4, radius * 0.4), Transparency = 0.15 })
	tween(disc, { time = 0.42, to = {
		Size = Vector3.new(0.1, radius * 2, radius * 2), Transparency = 1 } }, 0.42)
end

-- the beam: a block laid from A to B, because its Z axis runs down its length
function Effects.beam(from, to, color, width)
	width = width or 2.4
	local dist = (to - from).Magnitude
	if dist < 0.5 then return end
	local mid = from + (to - from) * 0.5
	local bar = part({ Color = color, Size = Vector3.new(width, width, dist),
		CFrame = CFrame.lookAt(mid, to), Transparency = 0.1 })
	tween(bar, { time = 0.1, to = { Size = Vector3.new(width * 1.7, width * 1.7, dist) } }, 0.12)
	tween(bar, { time = 0.22, to = { Transparency = 1 } }, 0.34)
end

-- a muzzle / charge-up: a small bright ball that swells before it fires
function Effects.charge(position, color, size, time)
	local ball = part({ Shape = Enum.PartType.Ball, Color = color,
		Size = Vector3.new(0.6, 0.6, 0.6), Position = position })
	tween(ball, { time = time * 0.7, style = Enum.EasingStyle.Back, to = { Size = size } }, time)
	return ball
end

-- death: the creature comes apart
function Effects.death(position, color, scale)
	scale = scale or 1
	for i = 1, 10 do
		local chunk = part({ Color = color, Size = Vector3.new(0.5, 0.5, 0.5) * scale,
			CFrame = CFrame.new(position) })
		chunk.CFrame = CFrame.new(position + Vector3.new(
			(math.random() - 0.5) * scale, (math.random() - 0.5) * scale, (math.random() - 0.5) * scale))
		tween(chunk, { time = 0.5, to = {
			CFrame = chunk.CFrame * CFrame.new(0, -3 * scale, 0)
				* CFrame.Angles(math.random() * 3, math.random() * 3, math.random() * 3),
			Transparency = 1 } }, 0.55)
	end
	Effects.shock(position, color, 9 * scale)
end

-- a number that floats up off a hit: the cheapest way to make damage legible
function Effects.number(position, amount, color, size)
	local anchor = part({ Transparency = 1, Size = Vector3.new(0.1, 0.1, 0.1),
		Position = position, Material = Enum.Material.SmoothPlastic })

	local billboard = Instance.new("BillboardGui")
	billboard.Adornee = anchor
	billboard.Size = UDim2.fromScale(4, 1.4)
	billboard.StudsOffset = Vector3.new((math.random() - 0.5) * 1.6, 2, 0)
	billboard.AlwaysOnTop = true
	billboard.Parent = anchor

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBlack
	label.TextScaled = true
	label.Text = tostring(math.floor(amount))
	label.TextColor3 = color or Color3.fromRGB(255, 236, 190)
	label.TextStrokeTransparency = 0.4
	label.TextStrokeColor3 = Color3.new(0, 0, 0)
	label.Parent = billboard

	TweenService:Create(billboard, TweenInfo.new(0.55, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		StudsOffset = billboard.StudsOffset + Vector3.new(0, 3 * (size or 1), 0),
	}):Play()
	TweenService:Create(label, TweenInfo.new(0.55), { TextTransparency = 1,
		TextStrokeTransparency = 1 }):Play()
	Debris:AddItem(anchor, 0.7)
end

return Effects
