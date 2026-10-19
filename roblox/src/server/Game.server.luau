--!nonstrict
--[[
	Game.server.luau - the whole game, authoritative on the server.

	It owns four things:

	  * the arena, rebuilt from Content whenever a stage starts
	  * the waves - spawn, count down, spawn the boss, clear, move on
	  * the monsters - a small state machine per creature, driven from Figure
	  * the players - health, combo, beam, roll, score

	The client is only allowed to ask (see Net.luau): it fires "I swung", "I
	fired", "I rolled", and sends where it was aiming.  Every one of those is
	re-checked here against cooldowns the server keeps, so a hacked client can
	spam the remote all it likes and still only swing as fast as the rules say.

	Monsters are stepped at 60 Hz on the server and their parts replicate, which
	is the honest trade for a starter: no client trust, no rollback, no
	prediction, and about a dozen creatures before it starts to cost anything.
	roblox/README.md documents how to move them to the clients when it does.

	Run this with Rojo (`rojo serve`) or paste it into ServerScriptService.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local shared = game:GetService("ReplicatedStorage"):WaitForChild("Battle")
local Content = require(shared:WaitForChild("Content"))
local Figure = require(shared:WaitForChild("Figure"))
local Effects = require(shared:WaitForChild("Effects"))
local Stage = require(shared:WaitForChild("Stage"))
local Net = require(shared:WaitForChild("Net"))

Net.init()
Players.RespawnTime = Content.player.respawn

local attackRemote = Net.event("Attack")
local beamRemote = Net.event("Beam")
local rollRemote = Net.event("Roll")
local stateRemote = Net.event("State")
local feedbackRemote = Net.event("Feedback")

local UP = Vector3.new(0, 1, 0)
local TARGET_AXIS = Vector3.new(0, 0, -1)

-- the yaw that turns this rig's own idea of "forward" into Roblox's -Z
local FORWARD_YAW = math.atan2(Figure.forward:Cross(TARGET_AXIS).Y,
	Figure.forward:Dot(TARGET_AXIS))

-- --------------------------------------------------------------------------
-- state
-- --------------------------------------------------------------------------
local Battle = {
	container = nil,     -- Folder holding every monster model (and nothing else,
	                     -- which is what makes the melee overlap query cheap)
	arena = nil,
	stageIndex = 1,
	waveIndex = 0,
	phase = "waiting",   -- waiting | intermission | fighting | cleared
	timer = 0,
	monsters = {},
	byModel = {},
	boss = nil,
}

local Sessions = {}    -- player -> per-player combat state

local function newContainer()
	local folder = Workspace:FindFirstChild("Battle")
	if folder then
		folder:ClearAllChildren()
	else
		folder = Instance.new("Folder")
		folder.Name = "Battle"
		folder.Parent = Workspace
	end
	return folder
end

local function livingTargets()
	local out = {}
	for _, player in ipairs(Players:GetPlayers()) do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if humanoid and root and humanoid.Health > 0 then
			out[#out + 1] = { player = player, root = root, humanoid = humanoid,
				position = root.Position }
		end
	end
	return out
end

local function nearestTarget(position, targets)
	local best, bestDist = nil, math.huge
	for _, t in ipairs(targets) do
		local d = (t.position - position).Magnitude
		if d < bestDist then
			best, bestDist = t, d
		end
	end
	return best, bestDist
end

-- --------------------------------------------------------------------------
-- facing
-- --------------------------------------------------------------------------
-- Every rig has its own idea of which way it points (Figure works it out from
-- the clips).  This turns "walk toward that player" into a CFrame for the rig.
local function faceAlong(position, towards)
	local dir = Vector3.new(towards.X, 0, towards.Z)
	if dir.Magnitude < 1e-3 then
		dir = TARGET_AXIS
	else
		dir = dir.Unit
	end
	local flat = Vector3.new(position.X, 0, position.Z)
	return CFrame.lookAt(flat, flat + dir) * CFrame.fromAxisAngle(UP, FORWARD_YAW)
end

-- --------------------------------------------------------------------------
-- monsters
-- --------------------------------------------------------------------------
local function spawnMonster(key, at, scale)
	local species = Content.speciesOf(key)
	local profile = Content.profiles[species.profile] or Content.profiles.brawler

	-- creatures walk in from the rim already facing the middle of the arena
	local facing = faceAlong(at.Position, -at.Position)
	local fig = Figure.new{
		species = species,
		profile = profile,
		slots = Content.clips,
		scale = scale or 1,
		root = CFrame.new(at.Position) * facing.Rotation,
		parent = Battle.container,
	}

	local monster = {
		key = key,
		species = species,
		fig = fig,
		model = fig.model,
		hp = species.health,
		max = species.health,
		state = "arrive",
		timer = 0.7 + math.random() * 0.5,
		cooldown = math.random() * 0.8,
		facing = facing.Rotation,
		keepOut = species.reach * 0.75,
	}
	Battle.monsters[#Battle.monsters + 1] = monster
	Battle.byModel[fig.model] = monster
	if species.boss then Battle.boss = monster end

	fig:play("idle")
	return monster
end

local function killMonster(monster, killer, at)
	if monster.state == "dying" then return end
	monster.state = "dying"
	monster.timer = 1.15
	monster.hp = 0
	monster.fig:play("death", { restart = true, fade = 0.08 })
	Effects.death(at or monster.fig:position(), monster.species.trim, 1.4)
	if killer then
		local session = Sessions[killer]
		if session then
			session.score += monster.species.bounty
			feedbackRemote:FireClient(killer, "kill", monster.species.bounty, monster.species.name)
		end
	end
end

local function damageMonster(monster, amount, attacker, at)
	if monster.state == "dying" then return end
	monster.hp -= amount

	local hitAt = at or monster.fig:position()
	monster.fig:flash(Color3.new(1, 0.86, 0.86), 0.1)
	Effects.hit(hitAt, monster.species.trim, 1.1)
	Effects.number(hitAt, amount, Color3.new(1, 0.94, 0.8), 1)

	if monster.hp <= 0 then
		killMonster(monster, attacker, hitAt)
		return
	end

	-- a hit interrupts whatever the creature was doing, which is what makes
	-- a combo feel like it is yours rather than a trade
	monster.state = "stagger"
	monster.timer = monster.species.boss and 0.18 or 0.3
	monster.fig:play("hit", { restart = true, fade = 0.06 })
end

local function monsterStrike(monster, targets)
	monster.state = "strike"
	monster.timer = 0.22

	local reach = monster.species.reach
	local fist = monster.fig:jointPosition("hand_l")
	local fistR = monster.fig:jointPosition("hand_r")
	local at = (fist + fistR) * 0.5

	local target, distance = nearestTarget(monster.fig:position(), targets)
	if target and distance < reach * 1.9 then
		local clock = os.clock()
		local session = Sessions[target.player]
		if not (session and clock < session.invulnUntil) then
			target.humanoid:TakeDamage(monster.species.damage)
			feedbackRemote:FireClient(target.player, "hurt", monster.species.damage)
		end
		Effects.hit(fist, monster.species.trim, 1.3)
	else
		Effects.shock(at, monster.species.trim, 3.5)
	end
end

local function updateMonster(monster, dt, targets, bounds)
	monster.timer -= dt
	monster.cooldown = math.max(0, monster.cooldown - dt)

	local position = monster.fig:position()
	local target, distance = nearestTarget(position, targets)
	local reach = monster.species.reach

	-- always face the nearest player; a creature that fights while side-on
	-- reads as broken even when the maths is right
	if target and distance < 260 then
		monster.facing = faceAlong(position, (target.position - position)).Rotation
	end

	if monster.state == "arrive" then
		if monster.timer <= 0 then monster.state = "chase" end

	elseif monster.state == "chase" then
		if not target then
			monster.fig:play("idle")
		elseif distance <= reach and monster.cooldown <= 0 then
			monster.state = "windup"
			monster.timer = monster.species.windup
			monster.fig:play(monster.species.boss and "slash" or "atk1",
				{ restart = true, fade = 0.08 })
		else
			-- hold a little further out than the reach, so two creatures do not
			-- stand inside one another while they wind up
			local speed = monster.species.speed
			if distance < monster.keepOut then
				speed = -speed * 0.55
			elseif distance < monster.keepOut * 1.8 then
				speed = speed * 0.4
			end
			if speed > 0 and distance < 26 then
				monster.fig:play("walk", { speed = math.max(speed / 12, 0.5) })
			elseif speed > 0 then
				monster.fig:play("run", { speed = math.max(speed / 18, 0.6) })
			else
				monster.fig:play("walk", { speed = 0.6 })
			end

			local dir = (target.position - position)
			dir = Vector3.new(dir.X, 0, dir.Z)
			if dir.Magnitude > 1e-3 then
				local stepped = position + dir.Unit * speed * dt
				local flat = Vector3.new(stepped.X, 0, stepped.Z)
				if flat.Magnitude > bounds then
					-- keep the fight inside the arena instead of in the fog
					flat = flat.Unit * bounds
					stepped = Vector3.new(flat.X, position.Y, flat.Z)
				end
				monster.fig:setRoot(CFrame.new(stepped) * monster.facing)
			end
		end

	elseif monster.state == "windup" then
		monster.fig:setRoot(CFrame.new(position) * monster.facing)
		if monster.timer <= 0 then
			monsterStrike(monster, targets)
		end

	elseif monster.state == "strike" then
		if monster.timer <= 0 then
			monster.state = "recover"
			monster.timer = monster.species.cooldown * 0.45
			monster.cooldown = monster.species.cooldown
		end

	elseif monster.state == "recover" then
		monster.fig:play("idle")
		if monster.timer <= 0 then monster.state = "chase" end

	elseif monster.state == "stagger" then
		-- knocked back a step so a combo visibly pushes the creature
		if target then
			local back = position - target.position
			back = Vector3.new(back.X, 0, back.Z)
			if back.Magnitude > 1e-3 then
				local pushed = position + back.Unit * dt * (monster.species.boss and 5 or 9)
				monster.fig:setRoot(CFrame.new(pushed) * monster.facing)
			end
		end
		if monster.timer <= 0 then monster.state = "chase" end

	elseif monster.state == "dying" then
		if monster.timer <= 0 then return true end
	end

	return false
end

local function retireMonster(monster)
	local index = table.find(Battle.monsters, monster)
	if index then table.remove(Battle.monsters, index) end
	Battle.byModel[monster.model] = nil
	if Battle.boss == monster then Battle.boss = nil end
	-- fade before deleting: a creature that dies should dissolve, not blink out
	task.spawn(function()
		for stage = 1, 6 do
			monster.fig:setTransparency(stage / 6)
			task.wait(0.035)
		end
		monster.fig:destroy()
	end)
end

-- --------------------------------------------------------------------------
-- waves
-- --------------------------------------------------------------------------
local function banner(text, color)
	for _, player in ipairs(Players:GetPlayers()) do
		feedbackRemote:FireClient(player, "banner", text, color)
	end
end

local function aliveCount()
	local n = 0
	for _, monster in ipairs(Battle.monsters) do
		if monster.state ~= "dying" then n += 1 end
	end
	return n
end

local function startStage(index)
	Battle.stageIndex = index
	Battle.waveIndex = 0
	Battle.boss = nil
	Battle.container = newContainer()
	Battle.arena = Stage.build(index)
	Battle.monsters = {}
	Battle.byModel = {}
	Battle.phase = "intermission"
	Battle.timer = 4

	local stage = Content.stageAt(index)
	banner(("STAGE %d  ·  %s"):format(index, string.upper(stage.name)), stage.trim)

	-- anyone already in the world gets moved to the new arena's spawn
	local slot = 0
	for _, player in ipairs(Players:GetPlayers()) do
		slot += 1
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if root then
			root.CFrame = Battle.arena.spawnPlayer(slot)
		end
	end
end

local function startWave()
	local stage = Content.stageAt(Battle.stageIndex)
	Battle.waveIndex += 1

	local wave = stage.waves[Battle.waveIndex]
	if wave then
		local slot = 0
		for _, entry in ipairs(wave) do
			for _ = 1, entry.count do
				slot += 1
				local at = Battle.arena.spawnPoint(slot, entry.from)
				spawnMonster(entry.species, at, 1)
			end
		end
		banner(("WAVE %d OF %d"):format(Battle.waveIndex, #stage.waves), stage.trim)
		Battle.phase = "fighting"
	else
		-- the boss arrives
		local at = Battle.arena.spawnPoint(1)
		spawnMonster(stage.boss, at, 1.4)
		banner(string.upper(Content.speciesOf(stage.boss).name) .. "  APPROACHES",
			Content.speciesOf(stage.boss).trim)
		Battle.phase = "fighting"
	end
end

local function waveCleared()
	local stage = Content.stageAt(Battle.stageIndex)
	local isBoss = Battle.waveIndex > #stage.waves
	if isBoss then
		banner("STAGE CLEAR", Color3.fromRGB(255, 226, 150))
		Battle.phase = "cleared"
		Battle.timer = 6
	else
		banner("WAVE CLEAR", Color3.fromRGB(180, 236, 200))
		Battle.phase = "intermission"
		Battle.timer = 4
	end
end

-- --------------------------------------------------------------------------
-- player actions
-- --------------------------------------------------------------------------
local function sessionOf(player)
	local session = Sessions[player]
	if not session then
		session = { score = 0, chain = 0, comboUntil = 0, lastAttack = 0,
			lastBeam = 0, lastRoll = 0, invulnUntil = 0 }
		Sessions[player] = session
	end
	return session
end

local function aimFrom(player, raw)
	if typeof(raw) ~= "Vector3" then return nil end
	local aim = Vector3.new(raw.X, 0, raw.Z)
	if aim.Magnitude < 1e-3 then return nil end
	return aim.Unit
end

local function playerRoot(player)
	local character = player.Character
	if not character then return nil, nil end
	local root = character:FindFirstChild("HumanoidRootPart")
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid or humanoid.Health <= 0 then return nil, nil end
	return root, humanoid
end

local function swing(player, aim)
	local session = sessionOf(player)
	local root = playerRoot(player)
	if not root then return end

	local clock = os.clock()
	local cfg = Content.player.combo
	if clock - session.lastAttack < cfg.recover then return end

	-- charge the combo to the next step, or start over if the window lapsed
	if clock > session.comboUntil then session.chain = 0 end
	session.chain = math.min(session.chain + 1, #cfg.chain)
	session.comboUntil = clock + cfg.window
	session.lastAttack = clock

	local damage = cfg.damage * cfg.chain[session.chain]
	local origin = root.Position + Vector3.new(0, 1.6, 0)
	local front = origin + aim * cfg.reach * 0.5

	local params = OverlapParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { Battle.container }

	local seen = {}
	local struck = 0
	local half = math.cos(math.rad(cfg.arc * 0.5))
	for _, part in ipairs(Workspace:GetPartBoundsInRadius(front, cfg.reach * 0.62, params)) do
		local monster = Battle.byModel[part.Parent]
		if monster and not seen[monster] then
			seen[monster] = true
			local to = monster.fig:position() - origin
			local flat = Vector3.new(to.X, 0, to.Z)
			if flat.Magnitude < 1e-3 or flat.Unit:Dot(aim) >= half then
				damageMonster(monster, damage, player, front)
				struck += 1
			end
		end
	end

	if struck > 0 then
		-- a small shove forward so the swing has weight; an impulse rather than
		-- a teleport, so the character's own physics stays in charge
		root:ApplyImpulse(aim * root.AssemblyMass * cfg.lunge)
		Effects.shock(root.Position, Color3.fromRGB(255, 236, 190), 4)
	end

	feedbackRemote:FireClient(player, "swing", session.chain, struck)
end

local function fireBeam(player, aim)
	local session = sessionOf(player)
	local root = playerRoot(player)
	if not root then return end

	local clock = os.clock()
	local cfg = Content.player.beam
	if clock - session.lastBeam < cfg.cooldown then return end
	session.lastBeam = clock

	local from = root.Position + Vector3.new(0, 2.2, 0) + aim * 1.5

	local rayParams = RaycastParams.new()
	rayParams.FilterType = Enum.RaycastFilterType.Exclude
	rayParams.FilterDescendantsInstances = { player.Character, Battle.container }

	local hit = Workspace:Raycast(from, aim * cfg.range, rayParams)
	local to = hit and hit.Position or (from + aim * cfg.range)

	Effects.beam(from, to, Color3.fromRGB(150, 226, 255), cfg.width)
	Effects.charge(from, Color3.fromRGB(200, 240, 255), Vector3.new(3, 3, 3), 0.25)

	local span = (to - from).Magnitude
	for _, monster in ipairs(Battle.monsters) do
		if monster.state ~= "dying" then
			local point = monster.fig:position() + Vector3.new(0, 2, 0)
			local along = math.clamp((point - from):Dot(aim), 0, span)
			local closest = from + aim * along
			if (point - closest).Magnitude < cfg.width + 3.2 then
				damageMonster(monster, cfg.damage, player, closest)
			end
		end
	end
end

local function roll(player, aim)
	local session = sessionOf(player)
	local root = playerRoot(player)
	if not root then return end

	local clock = os.clock()
	local cfg = Content.player.roll
	if clock - session.lastRoll < cfg.cooldown then return end
	session.lastRoll = clock
	session.invulnUntil = clock + cfg.invulnerable

	local dash = aim * (cfg.distance / cfg.time)
	root.AssemblyLinearVelocity = Vector3.new(dash.X, root.AssemblyLinearVelocity.Y + 6, dash.Z)
	Effects.shock(root.Position, Color3.fromRGB(180, 220, 255), 5)
end

-- --------------------------------------------------------------------------
-- remotes
-- --------------------------------------------------------------------------
attackRemote.OnServerEvent:Connect(function(player, rawAim)
	local aim = aimFrom(player, rawAim)
	if not aim then
		local root = playerRoot(player)
		aim = root and root.CFrame.LookVector or TARGET_AXIS
		aim = Vector3.new(aim.X, 0, aim.Z)
		aim = aim.Magnitude > 1e-3 and aim.Unit or TARGET_AXIS
	end
	swing(player, aim)
end)

beamRemote.OnServerEvent:Connect(function(player, rawAim)
	local aim = aimFrom(player, rawAim)
	if not aim then return end
	fireBeam(player, aim)
end)

rollRemote.OnServerEvent:Connect(function(player, rawAim)
	local aim = aimFrom(player, rawAim)
	if not aim then
		local root = playerRoot(player)
		aim = root and Vector3.new(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z) or TARGET_AXIS
		aim = aim.Magnitude > 1e-3 and aim.Unit or TARGET_AXIS
	end
	roll(player, aim)
end)

-- --------------------------------------------------------------------------
-- state broadcast
-- --------------------------------------------------------------------------
local sinceBroadcast = 0

local function broadcast()
	sinceBroadcast = 0
	local stage = Content.stageAt(Battle.stageIndex)
	local payload = {
		stageIndex = Battle.stageIndex,
		stageName = stage.name,
		wave = math.max(Battle.waveIndex, 1),
		waves = #stage.waves + 1,
		enemies = aliveCount(),
		phase = Battle.phase,
		scores = {},
	}
	for player, session in pairs(Sessions) do
		payload.scores[player.UserId] = session.score
	end
	if Battle.boss and Battle.boss.state ~= "dying" then
		payload.bossName = Battle.boss.species.name
		payload.bossHp = math.max(Battle.boss.hp, 0)
		payload.bossMax = Battle.boss.max
	end
	stateRemote:FireAllClients(payload)
end

-- --------------------------------------------------------------------------
-- players
-- --------------------------------------------------------------------------
local function joinSlot(player)
	local slot = 0
	for _, other in ipairs(Players:GetPlayers()) do
		slot += 1
		if other == player then return slot end
	end
	return slot
end

local function dressCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if not humanoid then return end
	humanoid.MaxHealth = Content.player.health
	humanoid.Health = Content.player.health
	humanoid.WalkSpeed = Content.player.walkSpeed
	humanoid.UseJumpPower = false
	humanoid.JumpHeight = Content.player.jumpHeight

	local root = character:WaitForChild("HumanoidRootPart", 10)
	if root and Battle.arena then
		root.CFrame = Battle.arena.spawnPlayer(joinSlot(player))
	end
end

Players.PlayerAdded:Connect(function(player)
	sessionOf(player)
	player.CharacterAdded:Connect(function(character)
		dressCharacter(player, character)
	end)
	if player.Character then
		dressCharacter(player, player.Character)
	end
	broadcast()
end)

Players.PlayerRemoving:Connect(function(player)
	Sessions[player] = nil
end)

for _, player in ipairs(Players:GetPlayers()) do
	sessionOf(player)
	if player.Character then dressCharacter(player, player.Character) end
	player.CharacterAdded:Connect(function(character)
		dressCharacter(player, character)
	end)
end

-- --------------------------------------------------------------------------
-- the loop
-- --------------------------------------------------------------------------
if not Battle.container then Battle.container = newContainer() end

RunService.Heartbeat:Connect(function(rawDt)
	local dt = math.min(rawDt, 0.1)

	local targets = livingTargets()

	if Battle.phase == "waiting" then
		if #targets > 0 then
			startStage(Battle.stageIndex)
		end
	elseif Battle.phase == "intermission" then
		Battle.timer -= dt
		if Battle.timer <= 0 then startWave() end
	elseif Battle.phase == "cleared" then
		Battle.timer -= dt
		if Battle.timer <= 0 then startStage(Battle.stageIndex + 1) end
	elseif Battle.phase == "fighting" then
		if aliveCount() == 0 then waveCleared() end
	end

	-- step the creatures and let the ones that finished dying go
	local bounds = Battle.arena and Battle.arena.radius * 0.9 or math.huge
	for index = #Battle.monsters, 1, -1 do
		local monster = Battle.monsters[index]
		local retire = updateMonster(monster, dt, targets, bounds)
		monster.fig:step(dt)
		if retire then retireMonster(monster) end
	end

	sinceBroadcast += dt
	if sinceBroadcast > 0.25 then broadcast() end
end)

print("[battle] server up - " .. tostring(#Content.stages) .. " stages loaded")
