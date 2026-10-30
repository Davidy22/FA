'use client';

/**
 * Turn an `functions.invoke` failure into something worth showing a shopper.
 *
 * `FunctionsHttpError.message` is always "Edge Function returned a non-2xx
 * status code"; the useful text is in the JSON body the function returned, so
 * read that first and only fall back to the generic message.
 */
export async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: { status?: number; json?: () => Promise<unknown> } })?.context;
  if (context?.json) {
    try {
      const body = await context.json();
      const message = (body as { error?: unknown } | null)?.error;
      if (typeof message === 'string' && message.trim()) return message.trim();
    } catch {
      // Not JSON (a gateway error page, for example); fall through.
    }
  }
  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && message && !message.startsWith('Edge Function returned')) {
    return message;
  }
  return fallback;
}

/** HTTP status of a failed `functions.invoke`, when the runtime provides one. */
export function edgeErrorStatus(error: unknown): number | undefined {
  return (error as { context?: { status?: number } })?.context?.status;
}
