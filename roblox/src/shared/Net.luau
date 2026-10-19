--!nonstrict
--[[
	Net.luau - the remote contract.

	One folder of RemoteEvents, created by the server on first use and waited
	for by the client, so neither side has to care which one started first.  The
	NAMES list is the whole protocol: if you add a remote, add it here and both
	sides see it.

	The client is only ever allowed to *ask*: every message it sends is treated
	as a request to be validated against the server's own idea of the player's
	state.  Nothing here trusts a number that came over the wire.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Net = {}
Net.FOLDER = "BattleNet"
Net.NAMES = { "Attack", "Beam", "Roll", "State", "Feedback" }

local cache = {}

function Net.event(name)
	local hit = cache[name]
	if hit then return hit end

	local folder = ReplicatedStorage:FindFirstChild(Net.FOLDER)
	if folder == nil then
		if RunService:IsServer() then
			folder = Instance.new("Folder")
			folder.Name = Net.FOLDER
			folder.Parent = ReplicatedStorage
		else
			folder = ReplicatedStorage:WaitForChild(Net.FOLDER)
		end
	end

	local remote = folder:FindFirstChild(name)
	if remote == nil then
		if RunService:IsServer() then
			remote = Instance.new("RemoteEvent")
			remote.Name = name
			remote.Parent = folder
		else
			remote = folder:WaitForChild(name)
		end
	end

	cache[name] = remote
	return remote
end

function Net.init()
	for _, name in ipairs(Net.NAMES) do
		Net.event(name)
	end
end

return Net
