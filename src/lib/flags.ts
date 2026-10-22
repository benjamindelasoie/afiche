/**
 * Operational feature flags — env toggles so a stage can be paused without a
 * code change or a cron edit. Default ON; a flag is OFF only when explicitly set
 * to a falsy word (0/false/off/no). Unset or empty means the default.
 *
 * Flags the self-heal loop reads:
 *   SELF_HEAL_ENABLED         master switch for the whole self-heal run
 *   SELF_HEAL_APPLY_ENABLED   auto-apply overrides (off = judge + queue only)
 *   LAYER2_ISSUES_ENABLED     open matcher-pattern issues
 *   ACTOR2_ENABLED            run the Actor 2 fix automation
 */

export function flagEnabled(name: string, dflt = true): boolean {
  const v = process.env[name];
  if (v == null || v.trim() === '') return dflt;
  return !/^(0|false|off|no)$/i.test(v.trim());
}
