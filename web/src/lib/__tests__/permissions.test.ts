import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_MODULES,
  canUseAdminConsole,
  cleanPermissions,
  hasPermission,
  isPermission,
} from '../permissions';
import type { Profile } from '../types';

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'user-1',
  email: 'staff@example.test',
  role: 'employee',
  location_id: 'loc-1',
  display_name: null,
  locale: 'en',
  is_creator: false,
  is_active: true,
  permissions: [],
  points_balance: 0,
  lifetime_points: 0,
  referral_code: 'ABCD123',
  referred_by: null,
  ...overrides,
});

describe('hasPermission', () => {
  it('lets an admin do everything', () => {
    expect(hasPermission(profile({ role: 'admin' }), 'settings.manage')).toBe(true);
    expect(hasPermission(profile({ role: 'admin' }), 'products.manage')).toBe(true);
  });

  it('grants only the assigned modules to staff', () => {
    const staff = profile({ permissions: ['products.manage'] });
    expect(hasPermission(staff, 'products.manage')).toBe(true);
    expect(hasPermission(staff, 'coupons.manage')).toBe(false);
    expect(canUseAdminConsole(staff)).toBe(true);
  });

  it('treats admin.full as every permission', () => {
    const superStaff = profile({ permissions: ['admin.full'] });
    for (const key of PERMISSIONS) expect(hasPermission(superStaff, key)).toBe(true);
  });

  it('never grants anything to customers or inactive accounts', () => {
    expect(hasPermission(profile({ role: 'customer', permissions: ['products.manage'] }), 'products.manage')).toBe(false);
    expect(hasPermission(profile({ permissions: ['products.manage'], is_active: false }), 'products.manage')).toBe(false);
    expect(hasPermission(null, 'products.manage')).toBe(false);
    expect(canUseAdminConsole(profile({ role: 'customer' }))).toBe(false);
  });
});

describe('permission helpers', () => {
  it('recognises only the real keys', () => {
    expect(isPermission('jobs.manage')).toBe(true);
    expect(isPermission('jobs.destroy')).toBe(false);
    expect(PERMISSION_MODULES).not.toContain('admin.full');
    expect(PERMISSION_MODULES.length).toBe(PERMISSIONS.length - 1);
  });

  it('cleans, de-duplicates and orders a selection', () => {
    expect(cleanPermissions(['coupons.manage', 'nope', 'products.manage', 'coupons.manage']))
      .toEqual(['products.manage', 'coupons.manage']);
    expect(cleanPermissions([])).toEqual([]);
  });
});
