import type { User } from '../auth/types';
import { apiFetch } from './apiClient';
import { createStore, useStoreValue } from './store';

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactNumber: string;
  email: string;
  branchHead: string;
  openingDate: string;
  status: 'Active' | 'Inactive';
  createdAt: string;
}

const SELECTED_BRANCH_STORAGE_KEY = 'guru_selected_branch';

// Single real branch, seeded server-side as well. `id` must stay in sync with
// the 'branch_main' id used server-side (server/server.js seed + branch-scoping
// default) so Admin accounts and imported students resolve to the same branch
// record here, and so the dropdown has something to show before the initial
// fetch below resolves.
const DEFAULT_BRANCHES: Branch[] = [
  {
    id: 'branch_main',
    name: 'Main',
    code: 'MAIN',
    address: '',
    city: '',
    state: '',
    pincode: '',
    contactNumber: '',
    email: '',
    branchHead: '',
    openingDate: '',
    status: 'Active',
    createdAt: new Date().toISOString(),
  },
];

const branchStore = createStore<Branch[]>(DEFAULT_BRANCHES);

function readSelectedBranchId() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const stored = window.localStorage.getItem(SELECTED_BRANCH_STORAGE_KEY);
  return stored || undefined;
}

function persistSelectedBranchId(branchId: string | undefined) {
  if (typeof window !== 'undefined') {
    if (branchId) {
      window.localStorage.setItem(SELECTED_BRANCH_STORAGE_KEY, branchId);
    } else {
      window.localStorage.removeItem(SELECTED_BRANCH_STORAGE_KEY);
    }
  }
}

let selectedBranchId: string | undefined = readSelectedBranchId();

export async function refreshBranches(): Promise<Branch[]> {
  try {
    const res = await apiFetch('/api/branches');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        branchStore.setState(data as Branch[]);
        return data;
      }
    }
  } catch (e) {
    console.error('Failed to fetch branches, using cache:', e);
  }
  return branchStore.getState();
}

// Initial load
void refreshBranches();

export function getBranches(): Branch[] {
  return branchStore.getState();
}

export function useBranches(): Branch[] {
  return useStoreValue(branchStore);
}

export function getBranchById(branchId?: string | null): Branch | undefined {
  if (!branchId) return undefined;
  return branchStore.getState().find((branch) => branch.id === branchId);
}

export function getBranchName(branchId?: string | null): string {
  const branch = getBranchById(branchId);
  return branch?.name ?? 'All Branches';
}

export function getSelectedBranchId(): string | undefined {
  return selectedBranchId;
}

export function setSelectedBranchId(branchId: string | undefined) {
  selectedBranchId = branchId;
  persistSelectedBranchId(branchId);
}

export async function addBranch(data: Omit<Branch, 'id' | 'createdAt'>): Promise<Branch | null> {
  try {
    const res = await apiFetch('/api/branches', { method: 'POST', body: data });
    if (res.ok) {
      const branch = await res.json();
      await refreshBranches();
      return branch;
    }
  } catch (err) {
    console.error('addBranch error:', err);
  }
  return null;
}

export async function updateBranch(branchId: string, updates: Partial<Branch>): Promise<Branch | null> {
  try {
    const res = await apiFetch(`/api/branches/${branchId}`, { method: 'PUT', body: updates });
    if (res.ok) {
      const branch = await res.json();
      await refreshBranches();
      return branch;
    }
  } catch (err) {
    console.error('updateBranch error:', err);
  }
  return null;
}

export async function toggleBranchStatus(branchId: string): Promise<Branch | null> {
  const branch = getBranchById(branchId);
  if (!branch) return null;
  return updateBranch(branchId, { status: branch.status === 'Active' ? 'Inactive' : 'Active' });
}

export async function deleteBranch(branchId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/branches/${branchId}`, { method: 'DELETE' });
    if (res.ok) {
      await refreshBranches();
      return true;
    }
  } catch (err) {
    console.error('deleteBranch error:', err);
  }
  return false;
}

export function getBranchScope(user: User | null, branchSelection?: string) {
  if (!user) {
    return { branchId: undefined, branchName: 'All Branches', isGlobal: true };
  }

  if (user.role === 'super_admin') {
    return {
      branchId: branchSelection || undefined,
      branchName: getBranchName(branchSelection || undefined),
      isGlobal: !branchSelection,
    };
  }

  if (user.role === 'admin' || user.role === 'accountant' || user.role === 'teacher' || user.role === 'parent') {
    const branchId = user.branchId || undefined;
    return {
      branchId,
      branchName: getBranchName(branchId),
      isGlobal: false,
    };
  }

  return { branchId: undefined, branchName: 'All Branches', isGlobal: true };
}

export function isBranchAccessible(branchId: string | undefined, user: User | null, branchSelection?: string) {
  const scope = getBranchScope(user, branchSelection);
  if (scope.isGlobal) {
    return true;
  }
  return !branchId || branchId === scope.branchId;
}

export function filterByBranch<T extends { branchId?: string | null }>(items: T[], user: User | null, branchSelection?: string) {
  return items.filter((item) => isBranchAccessible(item.branchId || undefined, user, branchSelection));
}
