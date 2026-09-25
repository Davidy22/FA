'use client';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import { useCart } from '@/store/cart';

export default function CheckoutSuccess() {
  const { t } = useTranslation('checkout');
  const params = useSearchParams();
  const clear = useCart((s) => s.clear);
  useEffect(() => { clear(); }, [clear]);
  return (
    <div className="container-fa py-20 text-center">
      <h1 className="text-3xl font-bold">{t('success')}</h1>
      <p className="mt-3 text-slate-600">{t('success_note', { email: params.get('email') || 'your email' })}</p>
      <Link href="/catalog" className="btn mt-6">{t('pickup')}</Link>
    </div>
  );
}
