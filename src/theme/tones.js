/* Tone names used across the app (Badge tone, ProgressBar, legend dots,
   chart colours) → theme tokens. Most are spec tokens of the same name;
   `primary` is the brand accent and `neutral` the faint text. */
const TONE_TOKEN = { primary: 'accent', neutral: 'text-faint', 'neutral-soft': 'surface-raised' };

/** Custom property for a tone: toneToken('primary') → '--app-accent'. */
export const toneToken = (tone) => `--app-${TONE_TOKEN[tone] || tone}`;

/** CSS value for a tone, for inline styles: toneVar('danger') → 'var(--app-danger)'. */
export const toneVar = (tone) => `var(${toneToken(tone)})`;
