'use client';
import Link from 'next/link';
import { useLocale } from '@/store/locale';

const rows = [
  { material: ['PLA', 'PLA', 'PLA'], quality: ['Standard', '標準', '标准'], rate: '$1.3/g' },
  { material: ['PETG', 'PETG', 'PETG'], quality: ['Durable', '耐用', '耐用'], rate: '$1.4/g' },
  { material: ['TPU', 'TPU', 'TPU'], quality: ['Flexible', '柔性', '柔性'], rate: '$1.5/g' },
  { material: ['ASA', 'ASA', 'ASA'], quality: ['Strong', '堅固', '坚固'], rate: '$1.6/g' },
];
const copy = {
  title: ['Pricing information', '價格資訊', '价格信息'],
  intro: ['Starter rates for 3D printing. Final quotes may vary with geometry, setup, and finishing.', '3D 列印入門價格。最終報價可能因模型形狀、設定及後加工而有所不同。', '3D 打印入门价格。最终报价可能因模型形状、设置及后加工而有所不同。'],
  material: ['Material', '材料', '材料'], quality: ['Type', '特性', '特性'], rate: ['Starter rate', '入門價格', '入门价格'],
  multi: ['Multi-material printing', '多材料列印', '多材料打印'],
  multiDesc: ['Add $0.1/g for multi-material prints.', '多材料列印每克另加 $0.1。', '多材料打印每克另加 $0.1。'],
  quote: ['Request a quote', '索取報價', '索取报价'],
};
export default function PricingPage() {
  const locale = useLocale((state) => state.locale);
  const index = locale === 'zh-Hant' ? 1 : locale === 'zh-Hans' ? 2 : 0;
  const t = (value: string[]) => value[index];
  return <div className="container-ma max-w-3xl py-10">
    <h1 className="text-3xl font-semibold">{t(copy.title)}</h1>
    <p className="mt-2 text-slate-600">{t(copy.intro)}</p>
    <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>
        <th className="p-3">{t(copy.material)}</th><th className="p-3">{t(copy.quality)}</th><th className="p-3">{t(copy.rate)}</th>
      </tr></thead><tbody>{rows.map((row) => <tr key={row.material[0]} className="border-t border-slate-200">
        <td className="p-3 font-medium">{row.material[index]}</td><td className="p-3">{row.quality[index]}</td><td className="p-3">{row.rate}</td>
      </tr>)}</tbody></table>
    </div>
    <section className="mt-5 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
      <h2 className="font-semibold">{t(copy.multi)}</h2><p className="mt-1 text-sm">{t(copy.multiDesc)}</p>
    </section>
    <Link href="/quote" className="btn mt-6">{t(copy.quote)}</Link>
  </div>;
}
