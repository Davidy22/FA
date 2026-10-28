'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { PERMISSION_MODULES, cleanPermissions, permissionKey } from '@/lib/permissions';
import type { Location, Profile } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminFeedback, AdminPagination, AdminQueryState, FormActions, useAdminAction } from './Shared';
import { FuzzySelect } from './FuzzySelect';

/** Permission checkboxes shared by the user editor. */
function PermissionPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useTranslation('admin');
  const toggle = (key: string) => onChange(
    value.includes(key) ? value.filter((entry) => entry !== key) : [...value, key],
  );
  return <fieldset className="rounded border border-slate-200 p-3">
    <legend className="px-1 text-sm font-medium">{t('fields.permissions')}</legend>
    <p className="text-xs text-slate-600">{t('permissions_help')}</p>
    <label className="mt-3 flex items-start gap-2 rounded bg-brand-50/60 p-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={value.includes('admin.full')}
        onChange={() => toggle('admin.full')} />
      <span>
        <strong>{t('permissions.admin_full')}</strong>
        <span className="block text-xs text-slate-600">{t('permission_descriptions.admin_full')}</span>
      </span>
    </label>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {PERMISSION_MODULES.map((key) => <label key={key} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={value.includes(key)}
          disabled={value.includes('admin.full')}
          onChange={() => toggle(key)} />
        <span>
          {t(`permissions.${permissionKey(key)}`)}
          <span className="block text-xs text-slate-500">{t(`permission_descriptions.${permissionKey(key)}`)}</span>
        </span>
      </label>)}
    </div>
    <div className="mt-3 flex gap-3 text-xs">
      <button type="button" className="text-brand-700 underline"
        onClick={() => onChange([...PERMISSION_MODULES])}>{t('select_all_permissions')}</button>
      <button type="button" className="text-slate-600 underline"
        onClick={() => onChange([])}>{t('clear_permissions')}</button>
    </div>
  </fieldset>;
}

function UserForm({ user, locations, onDone }: { user: Profile; locations: Location[]; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [role, setRole] = useState<Profile['role']>(user.role);
  const [locationId, setLocationId] = useState(user.location_id || '');
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [permissions, setPermissions] = useState<string[]>(user.permissions ?? []);
  const staffRole = ['employee', 'manager'].includes(role);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (['employee', 'manager'].includes(role) && !locations.some((location) => location.id === locationId && location.is_active)) {
        throw new Error(t('staff_location_required'));
      }
      const { error } = await supabase().rpc('admin_update_user', {
        p_user_id: user.id, p_role: role,
        p_location_id: staffRole ? locationId : null,
        p_display_name: displayName.trim() || null,
      });
      if (error) throw error;
      // Permissions are a separate RPC so the role/location rules stay in one
      // place; the server clears them when the account stops being staff.
      if (staffRole) {
        const { error: permissionError } = await supabase().rpc('admin_set_user_permissions', {
          p_user_id: user.id, p_permissions: cleanPermissions(permissions),
        });
        if (permissionError) throw permissionError;
      }
      await queryClient.invalidateQueries({ queryKey: ['admin_users'] });
    }, onDone);
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 rounded border border-brand-200 p-3 text-sm">
    <div className="grid gap-3 sm:grid-cols-2">
      <label>{t('fields.display_name')}<input className="input mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>{t('fields.role')}<select className="input mt-1" value={role} onChange={(event) => setRole(event.target.value as Profile['role'])}>
        {(['customer', 'employee', 'manager', 'admin'] as const).map((value) => <option value={value} key={value}>{t(`role.${value}`)}</option>)}
      </select></label>
    </div>
    {['employee', 'manager'].includes(role) && <label className="block">{t('fields.assigned_location')} *
      <div className="mt-1"><FuzzySelect value={locationId} onChange={setLocationId} emptyLabel="—" searchLabel={t('fields.assigned_location')}
        options={locations.filter((location) => location.is_active || location.id === user.location_id).map((location) => ({
          value: location.id, label: `${location.name}${location.is_active ? '' : ` (${t('inactive')})`}`,
        }))} /></div>
    </label>}
    {staffRole && <PermissionPicker value={permissions} onChange={setPermissions} />}
    <p className="text-xs text-slate-600">{t('user_roles_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function InviteStaff({ locations, onDone }: { locations: Location[]; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'employee' | 'manager'>('employee');
  const [locationId, setLocationId] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!locations.some((location) => location.id === locationId && location.is_active)) {
        throw new Error(t('staff_location_required'));
      }
      const { data, error } = await supabase().functions.invoke('create-staff', {
        body: { email: email.trim().toLowerCase(), display_name: displayName.trim(), role, location_id: locationId, password: password || null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await queryClient.invalidateQueries({ queryKey: ['admin_users'] });
    }, onDone);
  }
  return <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 p-4">
    <h3 className="font-medium">{t('invite_staff')}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.email')} *<input className="input mt-1" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm">{t('fields.display_name')}<input className="input mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="text-sm">{t('fields.role')}<select className="input mt-1" value={role} onChange={(event) => setRole(event.target.value as 'employee' | 'manager')}>
        <option value="employee">{t('role.employee')}</option><option value="manager">{t('role.manager')}</option>
      </select></label>
      <label className="text-sm">{t('fields.assigned_location')} *<div className="mt-1"><FuzzySelect value={locationId} onChange={setLocationId} emptyLabel="—"
        searchLabel={t('fields.assigned_location')} options={locations.filter((location) => location.is_active).map((location) => ({ value: location.id, label: location.name }))} /></div></label>
    </div>
    <label className="block text-sm">{t('fields.temporary_password')}<input className="input mt-1" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <p className="text-xs text-slate-600">{t('invite_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const usersQuery = useQuery<Profile[]>({
    queryKey: ['admin_users', page, filter],
    queryFn: async () => {
      let request = supabase().from('profiles').select('*')
        .order('created_at', { ascending: false })
        .range(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE - 1);
      if (filter) request = request.ilike('email', `%${filter}%`);
      const { data, error } = await request;
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });
  const locationsQuery = useQuery<Location[]>({
    queryKey: ['admin_locations'],
    queryFn: async () => {
      const { data, error } = await supabase().from('locations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });

  async function toggle(user: Profile) {
    if (!window.confirm(t(user.is_active ? 'deactivate_user_confirm' : 'activate_user_confirm', { email: user.email }))) return;
    await action.run(async () => {
      const { data, error } = await supabase().functions.invoke('set-user-active', {
        body: { user_id: user.id, active: !user.is_active },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await queryClient.invalidateQueries({ queryKey: ['admin_users'] });
    });
  }

  const users = usersQuery.data || [];
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">{t('users')}</h2>
      <p className="text-sm text-slate-600">{t('users_help')}</p></div>
      <button type="button" className="btn text-sm" onClick={() => setShowInvite((value) => !value)}>{t('invite_staff')}</button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={usersQuery.isPending || locationsQuery.isPending} error={usersQuery.error || locationsQuery.error} />
    {showInvite && <InviteStaff locations={locationsQuery.data || []} onDone={() => setShowInvite(false)} />}
    <form className="mt-4 flex max-w-lg items-end gap-2" onSubmit={(event) => {
      event.preventDefault(); setPage(0); setFilter(search.trim()); setEditing(null);
    }}>
      <label className="flex-1 text-sm">{t('search_users')}
        <input className="input mt-1" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <button className="btn" type="submit">{t('search_users')}</button>
    </form>
    {usersQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('no_users')}</p>}
    <div className="mt-4 space-y-2">{users.map((user) => <article key={user.id} className="rounded border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div>
        <p className="font-medium">{user.display_name || user.email} {user.id === currentUserId && `(${t('you')})`}</p>
        <p className="break-all text-slate-600">{user.email} · {t(`role.${user.role}`)} · {locationsQuery.data?.find((location) => location.id === user.location_id)?.name || '—'}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1">
          <span className="badge">{user.is_active ? t('active') : t('inactive')}</span>
          {user.role === 'admin'
            ? <span className="badge">{t('permissions.admin_full')}</span>
            : (user.permissions ?? []).map((key) => <span key={key} className="badge">
                {key === 'admin.full' ? t('permissions.admin_full') : t(`permissions.${key}`)}
              </span>)}
        </p>
      </div><div className="flex gap-2">
        <button type="button" className="text-brand-700 underline" onClick={() => setEditing(user.id)}>{t('edit_user')}</button>
        {user.id !== currentUserId && <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => void toggle(user)}>
          {user.is_active ? t('deactivate') : t('activate')}
        </button>}
      </div></div>
      {editing === user.id && <UserForm key={user.id} user={user} locations={locationsQuery.data || []} onDone={() => setEditing(null)} />}
    </article>)}</div>
    <AdminPagination page={page} hasNext={users.length === ADMIN_PAGE_SIZE}
      onPageChange={(next) => { setPage(next); setEditing(null); }} />
  </>;
}
