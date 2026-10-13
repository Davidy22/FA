'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
export default function ReferralsPage() {
  const { data: code } = useQuery({ queryKey: ['referral_code'], queryFn: async () => {
    const { data: { user } } = await supabase().auth.getUser();
    if (!user) return null;
    const { data } = await supabase().from('profiles').select('referral_code').eq('id', user.id).single();
    return data?.referral_code as string | undefined;
  }});
  return <div className="container-ma max-w-2xl py-10 space-y-5">
    <h1 className="text-2xl font-semibold">Refer a friend</h1>
    <p>Invite someone new to Make Anyth.ing. Earn 10 points when they sign up with your code, and 50 more points after their first purchase. They enter your code on the sign-up screen. Points can be redeemed on the <Link className="underline" href="/rewards">rewards page</Link>.</p>
    {code ? <div className="rounded-lg border p-5"><p className="text-sm">Your referral code</p><strong className="block break-all text-2xl">{code}</strong><button className="btn mt-3" onClick={() => navigator.clipboard.writeText(code)}>Copy code</button></div> : <Link className="btn" href="/login">Sign in to get your code</Link>}
  </div>;
}
