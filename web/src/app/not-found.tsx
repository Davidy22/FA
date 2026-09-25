'use client';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-fa py-20 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="btn mt-6 inline-block">Go home</Link>
    </div>
  );
}
