--!nonstrict
--[[
	Hud.luau - the console skin, built from code.

	Client only: the server never sees this file.  It is deliberately plain - no
	image assets, no gradients that need uploading, nothing that has to exist in
	your account before the game can look right.  Everything is Frames and
	TextLabels, so a fresh place gets the full look on first run.

		hud:setStage("Landing Zone", 2, 3, 5)
		hud:setHealth(84, 120)
		hud:setCombo(3)
		hud:setBoss("Red King", 120, 210)
		hud:banner("STAGE CLEAR", Color3.fromRGB(255, 220, 150))
		hud:hurt()
]]

local TweenService = game:GetService("TweenService")

local Hud = {}
Hud.__index = Hud

local BG = Color3.fromRGB(12, 14, 20)
local PANEL = Color3.fromRGB(20, 24, 33)
local ACCENT = Color3.fromRGB(228, 88, 74)
local ENERGY = Color3.fromRGB(112, 196, 232)
local DIM = Color3.fromRGB(148, 156, 172)
local INK = Color3.fromRGB(238, 240, 246)

local function panel(parent, size, position, anchor)
	local frame = Instance.new("Frame")
	frame.Size = size
	frame.Position = position
	frame.AnchorPoint = anchor or Vector2.new(0, 0)
	frame.BackgroundColor3 = PANEL
	frame.BackgroundTransparency = 0.22
	frame.BorderSizePixel = 0
	frame.Parent = parent

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 6)
	corner.Parent = frame

	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(70, 78, 96)
	stroke.Transparency = 0.5
	stroke.Parent = frame
	return frame
end

local function label(parent, text, size, position, font, color, anchor)
	local l = Instance.new("TextLabel")
	l.Text = text
	l.Size = size
	l.Position = position
	l.AnchorPoint = anchor or Vector2.new(0, 0)
	l.BackgroundTransparency = 1
	l.Font = font or Enum.Font.GothamMedium
	l.TextColor3 = color or INK
	l.TextSize = 16
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextYAlignment = Enum.TextYAlignment.Center
	l.RichText = false
	l.Parent = parent
	return l
end

local function bar(parent, size, position, fillColor)
	local holder = Instance.new("Frame")
	holder.Size = size
	holder.Position = position
	holder.BackgroundColor3 = BG
	holder.BackgroundTransparency = 0.25
	holder.BorderSizePixel = 0
	holder.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = holder

	local fill = Instance.new("Frame")
	fill.Size = UDim2.fromScale(1, 1)
	fill.BackgroundColor3 = fillColor
	fill.BorderSizePixel = 0
	fill.Parent = holder
	local inner = Instance.new("UICorner")
	inner.CornerRadius = UDim.new(1, 0)
	inner.Parent = fill
	return fill
end

function Hud.new(player)
	local gui = Instance.new("ScreenGui")
	gui.Name = "BattleHud"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	local self = setmetatable({}, Hud)
	self.gui = gui

	-- top left: which stage, which wave, how many left
	local stageBox = panel(gui, UDim2.fromOffset(300, 84), UDim2.fromOffset(20, 20))
	local accent = Instance.new("Frame")
	accent.Size = UDim2.new(0, 4, 1, -16)
	accent.Position = UDim2.fromOffset(10, 8)
	accent.BackgroundColor3 = ACCENT
	accent.BorderSizePixel = 0
	accent.Parent = stageBox

	self.stageLabel = label(stageBox, "LANDING ZONE", UDim2.new(1, -34, 0, 26),
		UDim2.fromOffset(24, 10), Enum.Font.GothamBlack, INK)
	self.stageLabel.TextSize = 20
	self.waveLabel = label(stageBox, "WAVE 1 / 3", UDim2.new(1, -34, 0, 18),
		UDim2.fromOffset(24, 36), Enum.Font.Code, ACCENT)
	self.countLabel = label(stageBox, "0 HOSTILE", UDim2.new(1, -34, 0, 18),
		UDim2.fromOffset(24, 56), Enum.Font.Code, DIM)

	-- top right: the score
	local scoreBox = panel(gui, UDim2.fromOffset(180, 60), UDim2.new(1, -20, 0, 20),
		Vector2.new(1, 0))
	self.scoreLabel = label(scoreBox, "0", UDim2.new(1, -20, 0, 30), UDim2.fromOffset(12, 8),
		Enum.Font.GothamBlack, ENERGY)
	self.scoreLabel.TextSize = 24
	self.scoreLabel.TextXAlignment = Enum.TextXAlignment.Right
	self.bountyLabel = label(scoreBox, "BOUNTY", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 38),
		Enum.Font.Code, DIM)
	self.bountyLabel.TextXAlignment = Enum.TextXAlignment.Right

	-- bottom centre: health and combo
	local vitals = panel(gui, UDim2.fromOffset(420, 76), UDim2.new(0.5, 0, 1, -24),
		Vector2.new(0.5, 1))
	self.healthFill = bar(vitals, UDim2.new(1, -32, 0, 18), UDim2.fromOffset(16, 16),
		Color3.fromRGB(120, 216, 140))
	self.healthLabel = label(vitals, "120 / 120", UDim2.new(0, 200, 0, 16),
		UDim2.fromOffset(20, 40), Enum.Font.Code, INK)
	self.comboLabel = label(vitals, "", UDim2.new(0, 200, 0, 22),
		UDim2.new(1, -120, 0, 38), Enum.Font.GothamBlack, ACCENT,
		Vector2.new(0, 0))
	self.comboLabel.TextXAlignment = Enum.TextXAlignment.Right

	-- bottom left: the controls, because a starter should explain itself
	local hints = label(gui, "CLICK  attack  ·  Q  beam  ·  SPACE  jump  ·  SHIFT  sprint",
		UDim2.fromOffset(560, 20), UDim2.new(0, 20, 1, -14), Enum.Font.Code, DIM)
	hints.AnchorPoint = Vector2.new(0, 1)

	-- the boss strip, hidden until there is a boss
	self.bossBox = panel(gui, UDim2.fromOffset(620, 62), UDim2.new(0.5, 0, 0, 18),
		Vector2.new(0.5, 0))
	self.bossBox.Visible = false
	self.bossFill = bar(self.bossBox, UDim2.new(1, -24, 0, 14), UDim2.fromOffset(12, 38), ACCENT)
	self.bossLabel = label(self.bossBox, "RED KING", UDim2.new(1, -24, 0, 22),
		UDim2.fromOffset(12, 10), Enum.Font.GothamBlack, INK)

	-- centre banner: wave callouts, stage clears
	self.banner = label(gui, "", UDim2.new(1, 0, 0, 60), UDim2.new(0, 0, 0.34, 0),
		Enum.Font.GothamBlack, INK)
	self.banner.TextSize = 44
	self.banner.TextXAlignment = Enum.TextXAlignment.Center
	self.banner.TextTransparency = 1

	-- a red wash when something lands on you
	self.hurt = Instance.new("Frame")
	self.hurt.Size = UDim2.fromScale(1, 1)
	self.hurt.BackgroundColor3 = Color3.fromRGB(180, 30, 30)
	self.hurt.BackgroundTransparency = 1
	self.hurt.BorderSizePixel = 0
	self.hurt.ZIndex = 0
	self.hurt.Parent = gui

	self.comboCount = 0
	self.comboExpiry = 0
	return self
end

function Hud:setStage(name, wave, waves, enemies)
	self.stageLabel.Text = string.upper(name)
	self.waveLabel.Text = ("WAVE %d / %d"):format(wave, waves)
	self:setEnemies(enemies)
end

function Hud:setEnemies(count)
	self.countLabel.Text = ("%d HOSTILE%s"):format(count, count == 1 and "" or "S")
end

function Hud:setScore(points)
	self.scoreLabel.Text = tostring(points)
end

function Hud:setHealth(hp, max)
	local fraction = math.clamp(hp / math.max(max, 1), 0, 1)
	TweenService:Create(self.healthFill, TweenInfo.new(0.18), {
		Size = UDim2.fromScale(fraction, 1),
	}):Play()
	self.healthFill.BackgroundColor3 =
		Color3.fromRGB(120, 216, 140):Lerp(Color3.fromRGB(226, 92, 74), 1 - fraction)
	self.healthLabel.Text = ("%d / %d"):format(math.max(hp, 0), max)
end

function Hud:setCombo(count, clock)
	self.comboCount = count
	if count > 1 then
		self.comboExpiry = (clock or os.clock()) + 1.4
		self.comboLabel.Text = ("x%d COMBO"):format(count)
	elseif count <= 0 then
		self.comboLabel.Text = ""
		self.comboExpiry = 0
	end
end

function Hud:tick(clock)
	if self.comboExpiry > 0 and clock > self.comboExpiry then
		self.comboLabel.Text = ""
		self.comboExpiry = 0
	end
end

function Hud:setBoss(name, hp, max)
	self.bossBox.Visible = true
	self.bossLabel.Text = string.upper(name)
	self.bossFill.Size = UDim2.fromScale(math.clamp(hp / math.max(max, 1), 0, 1), 1)
end

function Hud:clearBoss()
	self.bossBox.Visible = false
end

function Hud:banner(text, color, hold)
	self.banner.Text = text
	self.banner.TextColor3 = color or INK
	self.banner.TextTransparency = 0
	task.delay(hold or 1.6, function()
		if self.banner.Text == text then
			TweenService:Create(self.banner, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		end
	end)
end

function Hud:hurt()
	self.hurt.BackgroundTransparency = 0.72
	TweenService:Create(self.hurt, TweenInfo.new(0.3), { BackgroundTransparency = 1 }):Play()
end

return Hud
