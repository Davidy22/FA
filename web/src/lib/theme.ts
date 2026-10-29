// Site-wide appearance (light / dark / follow the system).
//
// The preference is applied from the root layout (see ThemeSync) so every page
// picks it up, not just the account screen where the setting lives. The inline
// bootstrap in layout.tsx applies the stored value before first paint, and a
// custom event keeps every AppearanceSelect in sync without a second store.

export type Appearance = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'make-anything-appearance';
export const APPEARANCE_EVENT = 'ma:appearance-change';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The stored preference, defaulting to following the system. */
export function readAppearance(): Appearance {
  if (typeof window === 'undefined') return 'auto';
  const saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'auto';
}

/** Which theme a preference resolves to right now. */
export function resolveTheme(appearance: Appearance = readAppearance()): ResolvedTheme {
  if (appearance !== 'auto') return appearance;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Write the resolved theme onto <html data-theme>. */
export function applyTheme(appearance: Appearance = readAppearance()): ResolvedTheme {
  const theme = resolveTheme(appearance);
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
  return theme;
}

/** Persist a preference, apply it, and tell any other selectors to catch up. */
export function saveAppearance(appearance: Appearance): ResolvedTheme {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    applyTheme(appearance);
    window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: appearance }));
  }
  return resolveTheme(appearance);
}

/** Run a callback whenever the appearance preference changes (same tab or another). */
export function onAppearanceChange(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_STORAGE_KEY) callback();
  };
  const onLocal = () => callback();
  media.addEventListener('change', onLocal);
  window.addEventListener('storage', onStorage);
  window.addEventListener(APPEARANCE_EVENT, onLocal);
  return () => {
    media.removeEventListener('change', onLocal);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(APPEARANCE_EVENT, onLocal);
  };
}
