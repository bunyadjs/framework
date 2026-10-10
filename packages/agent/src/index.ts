export { Agent, agent, type AgentArray, type HeaderReader } from "./agent.ts";
export {
  parseUserAgent,
  applyClientHints,
  setAgentCacheSize,
  clearAgentCache,
  type ParsedAgent,
  type DeviceType,
  type HeaderSource,
} from "./parser.ts";
