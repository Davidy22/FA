import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';
import { supabase } from '@/lib/supabase';
import '@/lib/i18n';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/supabase', () => ({ supabase: vi.fn() }));

let signIn: ReturnType<typeof vi.fn>;
let reset: ReturnType<typeof vi.fn>;

beforeEach(() => {
  signIn = vi.fn();
  reset = vi.fn(async () => ({ error: null }));
  vi.mocked(supabase).mockReturnValue({
    auth: {
      signInWithPassword: signIn,
      signUp: vi.fn(),
      resetPasswordForEmail: reset,
    },
  } as unknown as ReturnType<typeof supabase>);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('email authentication', () => {
  it('shows immediate busy feedback while sign-in is pending', async () => {
    let finish!: (value: { data: { session: object }; error: null }) => void;
    signIn.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'customer@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'LocalTest123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const working = await screen.findByRole('button', { name: 'Signing you in…' });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute('aria-busy', 'true');
    await act(async () => { finish({ data: { session: {} }, error: null }); });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it('sends a recovery link to the dedicated reset page', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'customer@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith('customer@example.test', {
      redirectTo: 'http://localhost:3000/reset-password/',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('If an account uses that email address');
  });
});
