-- Compare-and-swap for challenge status transitions.
--
-- KEYS[1] = device code key
-- ARGV[1] = expected status
-- ARGV[2] = expected userId (empty string for null)
-- ARGV[3] = new challenge JSON
--
-- Returns:
--   "OK"      on success
--   current   JSON string on mismatch
--   "NIL"     if key does not exist

local current = redis.call('GET', KEYS[1])
if not current then return 'NIL' end

local obj = cjson.decode(current)
local expectedUserId = ARGV[2]
if expectedUserId == '' then expectedUserId = nil end

if obj.status ~= ARGV[1] or obj.userId ~= expectedUserId then
  return current
end

redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL')
return 'OK'
