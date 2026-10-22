// Staff permissions, mirroring the SQL list in migration 20250101002400.
// The database is authoritative: `admin_set_user_permissions` rejects any key
// that is not in public.permission_keys(). Keep these two lists in step.

import type { Profile } from './types';

export const PERMISSIONS = [
  'admin.full',
  'products.manage',
  'coupons.manage',
  'jobs.manage',
  'quotes.manage',
  'orders.manage',
  'users.manage',
  'payouts.manage',
  'submissions.review',
  'locations.manage',
  'settings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The modules that can be granted, in the order the users panel lists them. */
export const PERMISSION_MODULES = PERMISSIONS.filter(
  (key): key is Exclude<Permission, 'admin.full'> => key !== 'admin.full',
);

/** Translation key segment for a permission ("products.manage" -> "products_manage"). */
export function permissionKey(key: string): string {
  return key.replace(/\./g, '_');
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * True when the account may use a module. Mirrors public.has_permission():
 * admins and `admin.full` holders pass everything, everyone else only their
 * granted keys (and inactive accounts pass nothing).
 */
export function hasPermission(
  profile: Pick<Profile, 'role' | 'permissions' | 'is_active'> | null | undefined,
  key: Permission,
): boolean {
  if (!profile || !profile.is_active) return false;
  if (profile.role === 'admin') return true;
  if (profile.role !== 'employee' && profile.role !== 'manager') return false;
  const granted = profile.permissions ?? [];
  return granted.includes('admin.full') || granted.includes(key);
}

/** True when the account can open any part of the admin console. */
export function canUseAdminConsole(
  profile: Pick<Profile, 'role' | 'permissions' | 'is_active'> | null | undefined,
): boolean {
  if (!profile || !profile.is_active) return false;
  if (profile.role === 'admin') return true;
  if (profile.role !== 'employee' && profile.role !== 'manager') return false;
  return (profile.permissions ?? []).length > 0;
}

/** Clean a permission selection before sending it to the RPC. */
export function cleanPermissions(values: readonly string[]): Permission[] {
  const seen = new Set<Permission>();
  for (const value of values) {
    if (isPermission(value)) seen.add(value);
  }
  return PERMISSIONS.filter((key) => seen.has(key));
}
