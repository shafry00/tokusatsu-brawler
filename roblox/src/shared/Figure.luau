--!nonstrict
--[[
	Figure.luau - builds a creature out of the generated rig, and animates it
	from the generated clip tables.

	There is no mesh, no Animator, no KeyframeSequence and no physics here.  The
	parts are anchored and placed by hand every frame in hierarchy order:

		frames[joint] = frames[parent] * rest[joint] * delta[joint]
		part.CFrame   = frames[joint] * offset[joint]

	which is exactly the formula tools/glb_to_roblox.py inverts when it bakes
	the clips, so playback is pixel-exact and identical on every machine.  It
	also means a creature costs 20 anchored parts and nothing else - cheap
	enough to run a dozen of them on the server.

	If you would rather drive a real skinned mesh, import your .glb in Studio
	and let Roblox's Animation Clip Editor build KeyframeSequences, then keep
	this module only for the decorated primitive rigs.

	Everything a caller needs:

		local fig = Figure.new{ rig = Rig, clips = clips, species = Content.species.jamila }
		fig:play("walk")
		fig:setRoot(CFrame.new(spawn))
		Connection = RunService.Heartbeat:Connect(function(dt) fig:step(dt) end)
		fig:flash(Color3.new(1, .4, .3), 0.14)
		fig:destroy()
]]

local Rig = require(script.Parent.Rig)
local clipLibrary = require(script.Parent.clips)

local Figure = {}
Figure.__index = Figure

local JOINT = Rig.joints
local COUNT = #JOINT

local PARENT, PIVOT, SIZE, REST, BONE, BY_NAME, IS_LIMB = {}, {}, {}, {}, {}, {}, {}
for i = 1, COUNT do
	local j = JOINT[i]
	PARENT[i] = j.parent
	PIVOT[i] = j.pivot == true
	SIZE[i] = Vector3.new(j.size[1], j.size[2], j.size[3])
	REST[i] = CFrame.new(j.rest[1], j.rest[2], j.rest[3])
		* CFrame.new(0, 0, 0,
			-- build the rotation straight from the quaternion the tool wrote
			1 - 2 * (j.rest[5] * j.rest[5] + j.rest[6] * j.rest[6]),
			2 * (j.rest[4] * j.rest[5] - j.rest[6] * j.rest[7]),
			2 * (j.rest[4] * j.rest[6] + j.rest[5] * j.rest[7]),
			2 * (j.rest[4] * j.rest[5] + j.rest[6] * j.rest[7]),
			1 - 2 * (j.rest[4] * j.rest[4] + j.rest[6] * j.rest[6]),
			2 * (j.rest[5] * j.rest[6] - j.rest[4] * j.rest[7]),
			2 * (j.rest[4] * j.rest[6] - j.rest[5] * j.rest[7]),
			2 * (j.rest[5] * j.rest[6] + j.rest[4] * j.rest[7]),
			1 - 2 * (j.rest[4] * j.rest[4] + j.rest[5] * j.rest[5]))
	BY_NAME[j.name] = i
	-- two-tone: the body reads as one shape, the limbs as another
	IS_LIMB[i] = (j.name:find("arm") or j.name:find("hand") or j.name:find("leg")
		or j.name:find("foot") or j.name:find("thigh") or j.name:find("calf")
		or j.name:find("clav") or j.name:find("shoulder") or j.name:find("wrist")
		or j.name:find("Thigh") or j.name:find("Calf") or j.name:find("Foot")) ~= nil

	-- a bone is drawn as a block hanging off the joint, pointing at the child
	-- bone, which is what turns a cloud of cubes into limbs
	local d = Vector3.new(j.dir[1], j.dir[2], j.dir[3])
	if not PIVOT[i] and j.len > 0.01 and d.Magnitude > 0.5 then
		local up = d.Unit
		local helper = math.abs(up.Y) > 0.99 and Vector3.new(1, 0, 0) or Vector3.new(0, 1, 0)
		local vx = helper:Cross(up)
		if vx.Magnitude < 1e-4 then vx = Vector3.new(1, 0, 0) end
		vx = vx.Unit
		BONE[i] = CFrame.fromMatrix(up * (j.len * 0.5), vx, up, vx:Cross(up))
	end
end

-- where do "front", "up" and "right" mean for this model?  The tool worked out
-- the facing from the clips, so horns and tails land the same way round even
-- for a .glb that was authored facing +Y.
local UP = Vector3.new(0, 1, 0)
local FWD = Vector3.new(Rig.forward[1], 0, Rig.forward[3])
if FWD.Magnitude < 0.01 then FWD = Vector3.new(0, 0, -1) end
FWD = FWD.Unit
local RIGHT = FWD:Cross(UP)
if RIGHT.Magnitude < 0.01 then RIGHT = Vector3.new(1, 0, 0) end
RIGHT = RIGHT.Unit
local FACING = CFrame.fromMatrix(Vector3.zero, RIGHT, UP, -FWD)

-- shapes: a Roblox Cylinder's axis runs along X, so lay it down along Y first
local SHAPE_TILT = { Cylinder = CFrame.fromEulerAnglesXYZ(0, 0, math.rad(90)) }

-- --------------------------------------------------------------------------
-- clips: decode once, lazily, and share the decoded tables between figures
-- --------------------------------------------------------------------------
local compiled = {}

local function decode(name)
	local cached = compiled[name]
	if cached ~= nil then return cached end
	local loader = clipLibrary[name]
	local data
	if type(loader) == "function" then
		local ok, got = pcall(loader)
		if ok then data = got end
	end
	if data == nil then
		compiled[name] = false
		return false
	end
	local channels = {}
	for joint, c in pairs(data.channels) do
		local n = #c.t
		local times, frames = table.create(n), table.create(n)
		local withPos = c.p ~= nil
		for k = 1, n do
			local qi = (k - 1) * 4
			local x, y, z, w = c.q[qi + 1], c.q[qi + 2], c.q[qi + 3], c.q[qi + 4]
			local rot = CFrame.new(0, 0, 0,
				1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
				2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
				2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y))
			if withPos then
				local pi = (k - 1) * 3
				frames[k] = CFrame.new(c.p[pi + 1], c.p[pi + 2], c.p[pi + 3]) * rot
			else
				frames[k] = rot
			end
			times[k] = c.t[k]
		end
		channels[joint] = { t = times, f = frames }
	end
	local out = { name = name, loop = data.loop, duration = data.duration, channels = channels }
	compiled[name] = out
	return out
end

local function sampleChannel(c, phase)
	local t, f = c.t, c.f
	local n = #t
	if n == 0 then return nil end
	if n == 1 or phase <= t[1] then return f[1] end
	if phase >= t[n] then return f[n] end
	local lo, hi = 1, n
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if t[mid] <= phase then lo = mid else hi = mid end
	end
	local span = t[hi] - t[lo]
	local a = span > 1e-6 and (phase - t[lo]) / span or 0
	return f[lo]:Lerp(f[hi], a)
end

-- --------------------------------------------------------------------------
-- building
-- --------------------------------------------------------------------------
local function makePart(model, name, size, color, material, shape)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = true
	part.Material = material or Enum.Material.SmoothPlastic
	part.Color = color
	part.Size = size
	if shape then part.Shape = shape end
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = model
	return part
end

local KIND_SHAPE = {
	cone = Enum.PartType.Cylinder,
	ball = Enum.PartType.Ball,
}

-- decorations: a profile describes them declaratively, this turns the
-- description into parts bolted to a named joint
function buildExtras(self, specs)
	self.extras = {}
	local palette = self.palette
	for _, e in ipairs(specs or {}) do
		local joint = BY_NAME[e.joint]
		if joint then
			local color = palette[e.shade or "trim"] or palette.trim
			local shape = KIND_SHAPE[e.kind]
			local shapeTilt = shape and SHAPE_TILT[shape.Name] or nil

			local function add(at, size, tilt)
				local part = makePart(self.model, e.joint .. "Extra", size, color, e.material, shape)
				self.extras[#self.extras + 1] = {
					part = part,
					joint = joint,
					at = at,
					tilt = (shapeTilt or CFrame.new()) * (tilt or e.tilt or CFrame.new()),
					color = color,
				}
			end

			if e.kind == "spikes" then
				-- a ridge: each spike steps further back along the body
				for k = 1, (e.count or 3) do
					add(e.at + Vector3.new(0, 0, (k - 1) * (e.spacing or 0.3)), e.size)
				end
			elseif e.kind == "tail" then
				for k = 1, (e.count or 3) do
					local shrink = 1 - (k - 1) * 0.2
					add(e.at + Vector3.new(0, (k - 1) * 0.08, (k - 1) * (e.step or 0.5)),
						e.size * shrink)
				end
			elseif e.kind == "wing" then
				local side = e.side or 1
				local at = Vector3.new(e.at.X * side, e.at.Y, e.at.Z)
				add(at, e.size,
					e.tilt or CFrame.fromEulerAnglesXYZ(0, math.rad(22 * side), math.rad(-14 * side)))
			else
				add(e.at, e.size)
			end
		end
	end
end

function Figure.new(opts)
	opts = opts or {}
	local self = setmetatable({}, Figure)

	local species = opts.species or {}
	local profile = opts.profile or {}
	self.name = opts.name or species.name or "Figure"
	self.scale = (opts.scale or 1) * (profile.height or 1)
	self.girth = opts.girth or profile.girth or 1
	self.rootJoint = 1
	self.root = opts.root or CFrame.new()
	self.palette = {
		hull = opts.hull or species.hull or Color3.fromRGB(150, 156, 168),
		trim = opts.trim or species.trim or Color3.fromRGB(210, 96, 82),
		glow = opts.glow or Color3.fromRGB(255, 226, 176),
	}
	self.slots = opts.slots or {}
	self.cur, self.prev = nil, nil
	self.fade, self.fadeDur = 1, 1
	self.flash, self.flashColor = 0, Color3.new(1, 0.4, 0.3)
	self.clock = 0

	local model = Instance.new("Model")
	model.Name = self.name
	self.model = model

	-- per figure: the rest pose at this creature's scale, plus the worn colours
	self.restLocal, self.frames, self.parts, self.colors = {}, {}, {}, {}
	local restPos, restRot = {}, {}
	for i = 1, COUNT do
		local localRest = CFrame.new(REST[i].Position * self.scale) * REST[i].Rotation
		self.restLocal[i] = localRest
		local pos, rot
		if PARENT[i] then
			local pp, pr = restPos[PARENT[i]], restRot[PARENT[i]]
			pos = pp + pr:VectorToWorldSpace(localRest.Position)
			rot = pr * localRest.Rotation
		else
			pos, rot = localRest.Position, localRest.Rotation
		end
		restPos[i], restRot[i] = pos, rot

		local color = IS_LIMB[i] and self.palette.trim or self.palette.hull
		self.colors[i] = color

		local part = makePart(model, JOINT[i].name,
			PIVOT[i] and Vector3.new(1, 1, 1) or SIZE[i] * (self.girth * self.scale),
			color, nil, nil)
		part.Transparency = PIVOT[i] and 1 or 0
		self.parts[i] = part
	end

	-- one invisible capsule-ish hitbox, so overlap queries and collisions have
	-- something cheap to hit instead of twenty stacked blocks
	local lo, hi = Vector3.new(1e9, 1e9, 1e9), Vector3.new(-1e9, -1e9, -1e9)
	for i = 1, COUNT do
		if not PIVOT[i] then
			lo = Vector3.new(math.min(lo.X, restPos[i].X), math.min(lo.Y, restPos[i].Y),
				math.min(lo.Z, restPos[i].Z))
			hi = Vector3.new(math.max(hi.X, restPos[i].X), math.max(hi.Y, restPos[i].Y),
				math.max(hi.Z, restPos[i].Z))
		end
	end
	local centre = (lo + hi) * 0.5
	local span = hi - lo
	local hitbox = makePart(model, "Hitbox",
		Vector3.new(math.max(span.X, 1) + 1.2, math.max(span.Y, 1), math.max(span.Z, 1) + 1.2),
		self.palette.hull, nil, nil)
	hitbox.Transparency = 1
	-- deliberately not a collider: an anchored block that is teleported every
	-- frame can fling a character that gets caught inside it.  Hits are decided
	-- by the overlap query below, not by the physics engine.
	hitbox.CanCollide = false
	hitbox.CanQuery = true
	self.hitbox = hitbox
	self.hitboxOffset = CFrame.new(centre)
	self.bounds = span

	buildExtras(self, opts.extras or profile.extras)

	self.model.Parent = opts.parent or workspace
	self:step(0)
	return self
end

function Figure:destroy()
	if self.model then self.model:Destroy() end
	self.model = nil
end

-- --------------------------------------------------------------------------
-- playback
-- --------------------------------------------------------------------------
function Figure:has(name)
	return decode(self.slots[name] or name) ~= false
end

function Figure:play(name, opts)
	opts = opts or {}
	local clip = decode(self.slots[name] or name)
	if clip == false then return false end
	if self.cur and self.cur.clip == clip and not opts.restart then
		if opts.speed then self.cur.speed = opts.speed end
		return true
	end
	self.prev = self.cur
	local loop = opts.loop
	if loop == nil then loop = clip.loop end
	self.cur = {
		clip = clip,
		phase = opts.phase or 0,
		speed = opts.speed or 1,
		loop = loop,
		finished = false,
	}
	self.fade = 0
	self.fadeDur = math.max(opts.fade or 0.16, 0)
	return true
end

-- true once a non-looping clip has run to its last keyframe
function Figure:finished()
	return self.cur ~= nil and self.cur.finished == true
end

function Figure:phase()
	return self.cur and self.cur.phase or 0
end

function Figure:setRoot(cf)
	self.root = cf
end

-- where a named joint currently is, for putting a hit spark on the fist that
-- threw the punch rather than in the middle of the creature
function Figure:jointPosition(name)
	local i = BY_NAME[name]
	if i and self.frames[i] then return self.frames[i].Position end
	return self:position()
end

function Figure:getRoot()
	return self.root
end

function Figure:position()
	return self.frames[self.rootJoint] and self.frames[self.rootJoint].Position or self.root.Position
end

function Figure:setTransparency(t)
	for i = 1, COUNT do
		local part = self.parts[i]
		if part and not PIVOT[i] then part.Transparency = t end
	end
	for _, e in ipairs(self.extras) do e.part.Transparency = t end
end

function Figure:flash(color, duration)
	self.flashColor = color or self.flashColor
	self.flash = math.max(self.flash, duration or 0.12)
	for i = 1, COUNT do
		local part = self.parts[i]
		if part then part.Color = self.flashColor end
	end
end

-- --------------------------------------------------------------------------
-- the frame
-- --------------------------------------------------------------------------
function Figure:step(dt)
	dt = dt or 0
	self.clock += dt

	if self.fade < self.fadeDur then
		self.fade = math.min(self.fadeDur, self.fade + dt)
	end
	local w = self.fadeDur > 0 and (self.fade / self.fadeDur) or 1
	if w >= 1 then self.prev = nil end

	local cur, prev = self.cur, self.prev
	if cur then
		cur.phase += dt * cur.speed
		if cur.loop then
			if cur.clip.duration > 0 then cur.phase = cur.phase % cur.clip.duration end
		elseif cur.phase >= cur.clip.duration then
			cur.phase = cur.clip.duration
			cur.finished = true
		end
	end
	if prev then
		prev.phase += dt * prev.speed
		if prev.loop and prev.clip.duration > 0 then
			prev.phase = prev.phase % prev.clip.duration
		end
	end

	local frames, root = self.frames, self.root
	for i = 1, COUNT do
		local p = PARENT[i]
		local base = p and frames[p] or root
		local delta
		if cur then
			local c = cur.clip.channels[i]
			if c then delta = sampleChannel(c, cur.phase) end
		end
		if prev and w < 1 then
			local c = prev.clip.channels[i]
			local from = c and sampleChannel(c, prev.phase)
			if from and delta then
				delta = from:Lerp(delta, w)
			elseif from then
				delta = from
			end
		end

		local cf = base * self.restLocal[i]
		if delta then cf = cf * delta end
		frames[i] = cf

		local part = self.parts[i]
		if part then
			local bone = BONE[i]
			part.CFrame = bone and (cf * bone) or cf
		end
	end

	-- decorations ride the joint they were bolted to, but keep the model's own
	-- orientation, so a horn never spins with the bone it happens to sit on
	local decoration = self.root.Rotation * FACING
	for _, e in ipairs(self.extras) do
		e.part.CFrame = CFrame.new(frames[e.joint].Position) * decoration
			* CFrame.new(e.at) * e.tilt
	end

	self.hitbox.CFrame = frames[self.rootJoint] * self.hitboxOffset

	if self.flash > 0 then
		self.flash = math.max(0, self.flash - dt)
		local warm = self.flash > 0
		for i = 1, COUNT do
			local part = self.parts[i]
			if part then
				part.Color = warm and self.flashColor or self.colors[i]
			end
		end
		if not warm then
			for _, e in ipairs(self.extras) do e.part.Color = e.color end
		end
	end
end

-- the model's own forward, in model space.  The server needs this to point a
-- creature at a player without knowing which .glb the rig came from.
Figure.forward = FWD

return Figure
