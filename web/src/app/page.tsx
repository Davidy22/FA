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
    <div className="container-ma py-10">
      {/* Reserved for a future promotions carousel */}
      <div id="promotions" aria-label="Promotions" className="empty:hidden" />

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
