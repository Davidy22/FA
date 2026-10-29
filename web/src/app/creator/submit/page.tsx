import Link from 'next/link';
export default function SubmitPage() {
  return <div className="container-ma max-w-2xl py-12">
    <h1 className="text-2xl font-semibold">Creator submissions are closed</h1>
    <p className="mt-3 text-slate-600">3D model uploads are no longer accepted. Contact us if you need help with an existing creator account.</p>
    <Link href="/creator" className="btn-outline mt-5 inline-flex">Back to creator dashboard</Link>
  </div>;
}
