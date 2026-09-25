'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ProductCard } from '@/components/ProductCard';
import type { PremadeProduct } from '@/lib/types';

export default function HomePage() {
  const { t } = useTranslation(['common','catalog']);
  const { data: featured, isLoading } = useQuery<PremadeProduct[]>({
    queryKey: ['featured'],
    queryFn: async () => {
      const { data } = await supabase().from('premade_products')
        .select('*').eq('status','published').eq('is_featured',true).limit(6);
      return data || [];
    },
  });
  return (
    <div className="container-fa py-10">
      <section className="rounded-2xl bg-gradient-to-br from-brand-50 to-white border border-brand-100 p-8 md:p-12">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">{t('common:app_name')}</h1>
        <p className="mt-3 text-lg text-slate-600 max-w-2xl">{t('common:tagline')}</p>
        <div className="mt-6 flex gap-3 flex-wrap">
          <Link href="/catalog" className="btn">{t('catalog:browse')}</Link>
          <Link href="/quote" className="btn-outline">{t('common:nav.quote')}</Link>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold mb-4">{t('catalog:browse')}</h2>
        {isLoading ? (
          <p>{t('common:loading')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured?.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
