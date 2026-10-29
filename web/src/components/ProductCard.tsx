'use client';
import Link from 'next/link';
import { t_db, formatMoney } from '@/lib/format';
import { useLocale } from '@/store/locale';
import { useSelectedLocation } from '@/hooks/useLocations';
import { effectivePrice } from '@/lib/sale';
import type { CatalogProduct } from '@/lib/types';

export function ProductCard({ product }: { product: CatalogProduct }) {
  const locale = useLocale((s) => s.locale);
  const currency = useSelectedLocation()?.currency;
  const name = t_db(product.name, locale);
  const label = (amount: number) => formatMoney(amount, locale, currency);
  const salePrice = effectivePrice(product.base_price, product);
  const onSale = salePrice < product.base_price;
  return (
    <Link href={`/product?slug=${encodeURIComponent(product.slug)}`} className="card block group">
      <div className="aspect-square bg-slate-100 flex items-center justify-center text-slate-400">
        {product.image_urls?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_urls[0]} alt={name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden className="text-4xl text-slate-300">◇</span>
        )}
      </div>
      <div className="p-2">
        <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{name}</h3>
        <div className="mt-1 text-sm font-medium text-slate-900">
            {onSale ? (<>
              {/* A sale shows the regular price struck through, sale price beside it. */}
              <s className="mr-1 font-normal text-slate-400">{label(product.base_price)}</s>
              <span className="text-rose-700">{label(salePrice)}</span>
            </>) : label(product.base_price)}
        </div>
      </div>
    </Link>
  );
}
