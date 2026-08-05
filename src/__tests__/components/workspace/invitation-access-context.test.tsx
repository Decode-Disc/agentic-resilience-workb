import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';

const { claimInvitation, useAction } = vi.hoisted(() => ({
    claimInvitation: vi.fn(),
    useAction: vi.fn(),
}));

vi.mock(import('convex/react'), () => ({ useAction }));

import {
    InvitationAccessProvider,
    useInvitationAccess,
} from '@/components/workspace/invitation-access-context';

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

function TestConsumer({ onSuccess }: { onSuccess?: () => void }) {
    const { openInvitationDrawer, isOpen } = useInvitationAccess();
    return (
        <div>
            <span data-testid="drawer-status">
                {isOpen ? 'Open' : 'Closed'}
            </span>
            <button
                type="button"
                onClick={() => openInvitationDrawer({ onSuccess })}
            >
                Open Access Drawer
            </button>
        </div>
    );
}

describe('InvitationAccessContext', () => {
    beforeAll(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    });

    beforeEach(() => {
        claimInvitation.mockReset();
        useAction.mockReset();
        useAction.mockReturnValue(claimInvitation);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    test('opens drawer and handles admission via context provider', async () => {
        const onSuccess = vi.fn();
        claimInvitation.mockResolvedValue({
            visitorId: 'visitor-1',
            role: 'analyst',
        });

        render(
            <InvitationAccessProvider>
                <TestConsumer onSuccess={onSuccess} />
            </InvitationAccessProvider>,
        );

        expect(screen.getByTestId('drawer-status').textContent).toBe('Closed');

        fireEvent.click(
            screen.getByRole('button', { name: /Open Access Drawer/i }),
        );

        expect(screen.getByTestId('drawer-status').textContent).toBe('Open');

        const accessCode = screen.getByLabelText(/Access code/i);
        fireEvent.change(accessCode, {
            target: { value: '4207' },
        });
        fireEvent.submit(
            screen.getByRole('form', { name: /Workspace access/i }),
        );

        await waitFor(() =>
            expect(claimInvitation).toHaveBeenCalledWith({
                code: '4207',
            }),
        );
        expect(onSuccess).toHaveBeenCalled();
        expect(screen.getByTestId('drawer-status').textContent).toBe('Closed');
    });
});
