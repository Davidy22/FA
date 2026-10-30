'use client';

import { useEffect, useState } from 'react';

/**
 * Delay a fast-changing value (a search box, for example) so the query behind it
 * runs once the customer pauses instead of once per keystroke. `useDeferredValue`
 * only deprioritises rendering; it still fires a request for every character.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);

  return debounced;
}
