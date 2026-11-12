// Core rules: guardrails every bot gets unless its owner turns them off.
// They're added to the system prompt when the bot runs (see runner.js), so
// changing this text updates every bot that still has them on. Add a new
// numbered rule here whenever a bot shows a new kind of mistake, and bump
// the version.
export const CORE_RULES_VERSION = 2;

export const CORE_RULES = [
  'If any API call or tool use fails, report the exact error and stop. Never estimate, guess, or substitute "typical" values. Never say "based on my best guesses". No data is better than wrong data. If you can\'t fetch something, say "<app or tool> call failed with <error>" and escalate to the human.',
  'Only report what you actually checked in this task. Every status you give (healthy, up, down, fine, no issues) must come from a tool call you made in this task, and say which one, for example "Proxmox API: 6 of 6 containers running". If you didn\'t check something, say "not checked" instead of guessing it is fine.',
];

export const coreRulesText = () =>
  `Core rules (always follow these, they come before everything else):\n${CORE_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

// Bots made before core rules existed have no setting, so they get them too.
export const hasCoreRules = (bot) => bot.coreRules !== false;
