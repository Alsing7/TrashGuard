// Tekst til klienten som { da, en }. Browseren vælger sproget (public/i18n.js), så serveren skal ikke kende det.
export const text = (da, en) => ({ da, en });

// En tekst, der selv kan være { da, en } (kendt-bloat.json, logposter) eller en almindelig streng, i ét sprog.
export const inLang = (value, lang) => (value && typeof value === 'object' ? value[lang] ?? value.da : value);
