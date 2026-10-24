import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColorSwatchGrid } from '@/components/ColorSwatchGrid';
import type { Filament } from '@/lib/types';

const colors: Filament[] = [
  { id: 'red', material_id: 'pla', color: { en: 'Red' }, color_hex: '#ff0000', finish: 'standard', is_active: true },
  { id: 'blue', material_id: 'pla', color: { en: 'Blue' }, color_hex: '#0000ff', finish: 'standard', is_active: true },
];

afterEach(cleanup);

describe('ColorSwatchGrid', () => {
  it('shows only the selected colour name above circular swatches', () => {
    const select = vi.fn();
    render(<ColorSwatchGrid colors={colors} selectedId="blue" onSelect={select} name="colour" />);
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.queryByText('Red')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Red' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Red' }));
    expect(select).toHaveBeenCalledWith('red');
  });
});
