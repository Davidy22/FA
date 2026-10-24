'use client';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { t_db, formatMaterial, formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { useSelectedLocation } from '@/hooks/useLocations';
import { effectivePrice } from '@/lib/sale';
import type { ProductWithMaterials } from '@/lib/types';

export function ProductCard({ product }: { product: ProductWithMaterials }) {
  const { t } = useTranslation('common');
  const locale = useLocale((s) => s.locale);
  const currency = useSelectedLocation()?.currency;
  const name = t_db(product.name, locale);
  const materialsList = product.product_materials || [];
  const firstMat = materialsList[0]?.material;
  const multiMat = materialsList.length > 1;
  const label = (amount: number) => multiMat
    ? t('from_price', { price: formatMoney(amount, locale, currency) })
    : formatMoney(amount, locale, currency);
  const salePrice = effectivePrice(product.base_price, product);
  const onSale = salePrice < product.base_price;
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
          <span className="text-sm font-medium text-slate-900 whitespace-nowrap">
            {onSale ? (<>
              {/* A sale shows the regular price struck through, sale price beside it. */}
              <s className="mr-1 font-normal text-slate-400">{label(product.base_price)}</s>
              <span className="text-rose-700">{label(salePrice)}</span>
            </>) : label(product.base_price)}
          </span>
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
