'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { SOCIAL_PROVIDERS, authCallbackUrl, rememberAuthNext, type SocialProviderId } from '@/lib/auth';
import { ProviderIcon } from './ProviderIcon';

export function SocialAuthButtons({
  next = '/',
  disabled = false,
  onStart,
  onError,
}: {
  next?: string;
  disabled?: boolean;
  onStart?: () => void;
  onError?: (message: string | null, provider?: SocialProviderId) => void;
}) {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState<SocialProviderId | null>(null);

  async function start(provider: SocialProviderId) {
    setBusy(provider);
    onError?.(null);
    onStart?.();
    try {
      rememberAuthNext(next);
      const { error } = await supabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) throw error;
      // signInWithOAuth redirects the browser; keep the busy state until it does.
    } catch (e) {
      setBusy(null);
      onError?.((e as Error).message, provider);
    }
  }

  return (
    <div className="grid gap-2">
      {SOCIAL_PROVIDERS.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className="btn-outline w-full gap-3"
          disabled={disabled || busy !== null}
          aria-busy={busy === provider.id}
          onClick={() => void start(provider.id)}
        >
          <ProviderIcon provider={provider.id} />
          <span>
            {busy === provider.id
              ? t('auth.redirecting')
              : t('auth.continue_with', { provider: provider.label })}
          </span>
        </button>
      ))}
    </div>
  );
}
