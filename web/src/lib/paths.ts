// Next's Link/router add basePath automatically, but raw asset/redirect URLs do not.
export function withBasePath(path: string): string {
  const basePath = process.env.NODE_ENV === 'production'
    ? process.env.NEXT_PUBLIC_BASE_PATH || ''
    : '';
  return `${basePath}${path}`;
}
