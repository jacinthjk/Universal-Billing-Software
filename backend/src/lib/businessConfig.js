const { DEFAULT_SETTINGS, DEFAULT_WEBSITE, DEFAULT_AI, THEMES, BUSINESS_TYPES, LATER_MODULES, terminologyFor } = require('./presets');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

// Returns the business with all JSON config blocks merged over platform defaults.
function withDefaults(raw) {
  // Never expose the bill passcode hash; callers only need to know whether one is set.
  const { billPasscodeHash, ...b } = raw;
  const settings = deepMerge(DEFAULT_SETTINGS, b.settings);
  const off = settings.modulesOff || [];
  settings.modules = [...settings.modules, ...LATER_MODULES.filter((m) => !settings.modules.includes(m) && !off.includes(m))];
  return {
    ...b,
    hasBillPasscode: !!billPasscodeHash,
    // Base theme: the chosen preset, else the business type's preset - so colours and icon fit the business.
    theme: deepMerge(THEMES[b.theme?.key] || THEMES[BUSINESS_TYPES[b.type]?.theme] || THEMES.classic, b.theme),
    terminology: terminologyFor(b.type, b.terminology),
    settings,
    website: deepMerge(DEFAULT_WEBSITE, b.website),
    ai: deepMerge(DEFAULT_AI, b.ai),
  };
}

module.exports = { withDefaults, deepMerge };
