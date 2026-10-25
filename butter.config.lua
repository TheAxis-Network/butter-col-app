-- butter-col-app configuration.
-- `npm start` runs: butter-col server start --site public --config butter.config.lua
-- Anything left out falls back to the package defaults (lua/butter/config.lua).

return {
  -- "none" | "plain" | "xor" | "base64". The Formatter tab shows all four.
  codec = "plain",

  transports = {
    { name = "butter" },  -- built in: this OpenResty server
    -- After `npm i @axis-network/bare-transport && npx butter-col transport add @axis-network/bare-transport`:
    -- { name = "bare", options = { server = "https://bare.example.com/" } },
  },
  default_transport = "butter",

  guard = {
    -- Keep false: the test bench checks that private addresses are blocked.
    allow_private = false,
  },
}
