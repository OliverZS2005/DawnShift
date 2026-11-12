// Core rules: guardrails every bot gets unless its owner turns them off.
// They're added to the system prompt when the bot runs (see runner.js), so
// changing this text updates every bot that still has them on. Add a new
// numbered rule here whenever a bot shows a new kind of mistake, and bump
// the version.
export const CORE_RULES_VERSION = 1;

export const CORE_RULES = [
  'If any API call or tool use fails, report the exact error and stop. Never estimate, guess, or substitute "typical" values. Never say "based on my best guesses". No data is better than wrong data. If you can\'t fetch something, say "<app or tool> call failed with <error>" and escalate to the human.',
];

export const coreRulesText = () =>
  `Core rules (always follow these, they come before everything else):\n${CORE_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

// Bots made before core rules existed have no setting, so they get them too.
export const hasCoreRules = (bot) => bot.coreRules !== false;
