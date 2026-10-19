--!nonstrict
--[[
	Controller.client.luau - input, HUD and feel.

	Deliberately thin.  Roblox's own character controller already gives you
	walking, jumping, camera and a stock avatar, and the whole point of the
	Roblox target is that a player brings their own avatar and UGC - so this
	script does not replace the controller, it only adds what the game needs:

	  * three inputs: swing, beam, roll (plus sprint on shift)
	  * the HUD, driven by the server's State messages
	  * camera shake, which is most of what "a hit landed" actually feels like

	Every input here is optimistic the way a client should be: it fires the
	remote and lets the server decide.  The local cooldowns exist only to keep
	the remote from being spammed, and they are slightly *shorter* than the
	server's, so the server is always the one that says no.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local shared = game:GetService("ReplicatedStorage"):WaitForChild("Battle")
local Content = require(shared:WaitForChild("Content"))
local Net = require(shared:WaitForChild("Net"))
local Hud = require(script.Parent:WaitForChild("Hud"))

local player = Players.LocalPlayer

-- the stock health bar would duplicate the game's own; hide it and let the
-- Humanoid stay the single source of truth for player health
pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Health, false)
end)

local hud = Hud.new(player)

local nextAttack, nextBeam, nextRoll = 0, 0, 0
local sprinting = false
local shake = 0
local humanoid, rootPart, lastHealth = nil, nil, nil

local function addShake(amount)
	shake = math.min(shake + amount, 2.4)
end

local function aim()
	local camera = Workspace.CurrentCamera
	local look
	if camera then
		look = camera.CFrame.LookVector
	elseif rootPart then
		look = rootPart.CFrame.LookVector
	end
	if not look then return Vector3.new(0, 0, -1) end
	local flat = Vector3.new(look.X, 0, look.Z)
	return flat.Magnitude > 1e-3 and flat.Unit or Vector3.new(0, 0, -1)
end

local function watchCharacter(character)
	humanoid = character:WaitForChild("Humanoid", 10)
	rootPart = character:WaitForChild("HumanoidRootPart", 10)
	lastHealth = nil
	if humanoid then
		hud:setHealth(humanoid.Health, humanoid.MaxHealth)
	end
end

if player.Character then watchCharacter(player.Character) end
player.CharacterAdded:Connect(watchCharacter)

-- --------------------------------------------------------------------------
-- input
-- --------------------------------------------------------------------------
local function swing()
	local clock = os.clock()
	local cfg = Content.player.combo
	if clock < nextAttack then return end
	nextAttack = clock + cfg.recover * 0.85
	Net.event("Attack"):FireServer(aim())
end

local function beam()
	local clock = os.clock()
	local cfg = Content.player.beam
	if clock < nextBeam then return end
	nextBeam = clock + cfg.cooldown * 0.9
	Net.event("Beam"):FireServer(aim())
end

local function roll()
	local clock = os.clock()
	local cfg = Content.player.roll
	if clock < nextRoll then return end
	nextRoll = clock + cfg.cooldown * 0.9
	Net.event("Roll"):FireServer(aim())
	addShake(0.5)
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	local kind = input.UserInputType
	if kind == Enum.UserInputType.MouseButton1 then
		swing()
	elseif kind == Enum.UserInputType.Touch then
		swing()
	elseif kind == Enum.UserInputType.Gamepad1 then
		if input.KeyCode == Enum.KeyCode.ButtonR2 then
			swing()
		elseif input.KeyCode == Enum.KeyCode.ButtonR1 then
			beam()
		elseif input.KeyCode == Enum.KeyCode.ButtonB then
			roll()
		elseif input.KeyCode == Enum.KeyCode.ButtonL3 then
			sprinting = true
		end
	elseif kind == Enum.UserInputType.Keyboard then
		if input.KeyCode == Enum.KeyCode.F then
			swing()
		elseif input.KeyCode == Enum.KeyCode.Q then
			beam()
		elseif input.KeyCode == Enum.KeyCode.R then
			roll()
		elseif input.KeyCode == Enum.KeyCode.LeftShift then
			sprinting = true
		end
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.LeftShift
		or input.KeyCode == Enum.KeyCode.ButtonL3 then
		sprinting = false
	end
end)

-- --------------------------------------------------------------------------
-- what the server says happened
-- --------------------------------------------------------------------------
Net.event("Feedback").OnClientEvent:Connect(function(kind, a, b)
	if kind == "swing" then
		if (b or 0) > 0 then
			hud:setCombo(a or 1)
			addShake(0.3 + (a or 1) * 0.12)
		else
			hud:setCombo(-1)
		end
	elseif kind == "kill" then
		addShake(0.45)
		if (a or 0) >= 6 then
			hud:banner(string.upper(tostring(b)) .. "  DOWN", Color3.fromRGB(255, 226, 150), 1.4)
		end
	elseif kind == "hurt" then
		hud:hurt()
		addShake(0.85)
	elseif kind == "banner" then
		hud:banner(tostring(a), b, 1.9)
	end
end)

Net.event("State").OnClientEvent:Connect(function(state)
	if type(state) ~= "table" then return end
	hud:setStage(state.stageName or "Arena", state.wave or 1, state.waves or 1,
		state.enemies or 0)
	hud:setScore((state.scores and state.scores[player.UserId]) or 0)
	if state.bossName then
		hud:setBoss(state.bossName, state.bossHp or 0, state.bossMax or 1)
	else
		hud:clearBoss()
	end
end)

-- --------------------------------------------------------------------------
-- the frame
-- --------------------------------------------------------------------------
RunService:BindToRenderStep("battleFeel", Enum.RenderPriority.Camera.Value + 1,
	function(dt)
		-- sprint is a client-side courtesy: it changes nothing the server has to
		-- agree with, so it does not need a remote
		if humanoid and humanoid.Health > 0 then
			local base = Content.player.walkSpeed
			humanoid.WalkSpeed = sprinting and base * Content.player.sprintMultiplier or base
			if humanoid.Health ~= lastHealth then
				lastHealth = humanoid.Health
				hud:setHealth(humanoid.Health, humanoid.MaxHealth)
			end
		end

		local camera = Workspace.CurrentCamera
		if camera and shake > 0.001 then
			shake = math.max(0, shake - dt * 3.6)
			local offset = Vector3.new(math.random() - 0.5, math.random() - 0.5, 0)
				* shake * 0.55
			camera.CFrame = camera.CFrame * CFrame.new(offset)
		elseif shake > 0 then
			shake = 0
		end

		hud:tick(os.clock())
	end)

print("[battle] client ready - click to swing, Q to fire, R to roll")
