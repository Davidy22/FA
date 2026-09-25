'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { t_db, formatMaterial, formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import type { Material, PremadeProduct, ProductMaterial } from '@/lib/types';

export function ProductCard({ product }: { product: PremadeProduct }) {
  const { t } = useTranslation('common');
  const locale = useLocale((s) => s.locale);
  const { data: materials } = useQuery<(ProductMaterial & { material: Material })[]>({
    queryKey: ['product_materials', product.id],
    queryFn: async () => {
      const { data } = await supabase().from('product_materials')
        .select('*, material:materials(*)').eq('product_id', product.id);
      return data as any;
    },
  });
  const name = t_db(product.name, locale);
  const materialsList = materials || [];
  const firstMat = materialsList[0]?.material;
  const multiMat = materialsList.length > 1;
  const priceStr = multiMat
    ? t('from_price', { price: formatMoney(product.base_price, locale) })
    : formatMoney(product.base_price, locale);
  return (
    <Link href={`/product?slug=${encodeURIComponent(product.slug)}`} className="card block group">
      <div className="aspect-square bg-slate-100 flex items-center justify-center text-slate-400">
        {product.image_urls?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_urls[0]} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm">3D</span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{name}</h3>
          <span className="text-sm font-medium text-slate-900 whitespace-nowrap">{priceStr}</span>
        </div>
        {firstMat && (
          <div className="mt-2">
            <span className="badge">{formatMaterial(firstMat, locale)}</span>
            {product.submitted_by && (
              <span className="ml-2 badge bg-emerald-50 text-emerald-700">{t('community_design')}</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
