import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetPasswordPage from '@/app/reset-password/page';
import { supabase } from '@/lib/supabase';
import '@/lib/i18n';

vi.mock('@/lib/supabase', () => ({ supabase: vi.fn() }));
let updateUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  updateUser = vi.fn(async () => ({ error: null }));
  vi.mocked(supabase).mockReturnValue({
    auth: {
      initialize: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'recovery' } }, error: null })),
      updateUser,
    },
  } as unknown as ReturnType<typeof supabase>);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('password recovery', () => {
  it('validates confirmation and sets the new password on the recovery session', async () => {
    render(<ResetPasswordPage />);
    const password = await screen.findByLabelText('New password');
    const confirmation = screen.getByLabelText('Confirm new password');
    fireEvent.change(password, { target: { value: 'NewPassword123!' } });
    fireEvent.change(confirmation, { target: { value: 'Different123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.');
    expect(updateUser).not.toHaveBeenCalled();

    fireEvent.change(confirmation, { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'NewPassword123!' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been updated.');
  });
});
