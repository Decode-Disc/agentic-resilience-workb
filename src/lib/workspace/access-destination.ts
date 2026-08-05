import type { api } from '@convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';

type WorkspaceRole = FunctionReturnType<typeof api.invitations.claim>['role'];

/**
 * Returns the first workspace page that is useful for the admitted visitor.
 */
export function getWorkspaceDestination(role: WorkspaceRole) {
    return role === 'admin' ? '/workspace/admin' : '/workspace/dossiers';
}
