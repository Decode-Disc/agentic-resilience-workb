import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspacePrototype } from '@/components/workspace-prototype/workspace-prototype';

describe('WorkspacePrototype', () => {
    it('uses the global evidence workbench design system', () => {
        render(<WorkspacePrototype variant="a" onVariantChange={vi.fn()} />);

        expect(
            screen
                .getByText('Throwaway UI prototype')
                .closest('.theme-evidence-workbench'),
        ).toBeNull();
    });
});
