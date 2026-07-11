import type { User } from '../auth/types';

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

const BRANCH_STORAGE_KEY = 'guru_branch_state';
const SELECTED_BRANCH_STORAGE_KEY = 'guru_selected_branch';

const DEFAULT_BRANCHES: Branch[] = [
  {
    id: 'branch_rajajinagar',
    name: 'Rajajinagar Branch',
    code: 'RJG',
    address: '15, 1st Main, Rajajinagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560010',
    contactNumber: '+91 9876543201',
    email: 'rajajinagar@gurushishyaru.com',
    branchHead: 'Rahul Sharma',
    openingDate: '2022-01-10',
    status: 'Active',
    createdAt: '2022-01-10',
  },
  {
    id: 'branch_jayanagar',
    name: 'Jayanagar Branch',
    code: 'JYN',
    address: '42, 4th Block, Jayanagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560041',
    contactNumber: '+91 9876543202',
    email: 'jayanagar@gurushishyaru.com',
    branchHead: 'Nisha Rao',
    openingDate: '2023-03-12',
    status: 'Active',
    createdAt: '2023-03-12',
  },
  {
    id: 'branch_vijayanagar',
    name: 'Vijayanagar Branch',
    code: 'VJN',
    address: '88, Vijayanagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560040',
    contactNumber: '+91 9876543203',
    email: 'vijayanagar@gurushishyaru.com',
    branchHead: 'Asha Menon',
    openingDate: '2024-06-02',
    status: 'Active',
    createdAt: '2024-06-02',
  },
  {
    id: 'branch_hsr',
    name: 'HSR Layout Branch',
    code: 'HSR',
    address: '9, HSR Layout',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560102',
    contactNumber: '+91 9876543204',
    email: 'hsr@gurushishyaru.com',
    branchHead: 'Ravi Kumar',
    openingDate: '2024-10-15',
    status: 'Inactive',
    createdAt: '2024-10-15',
  },
];

let branchState: Branch[] = [];
let selectedBranchId: string | undefined;
const listeners = new Set<() => void>();

function loadBranches() {
  if (typeof window === 'undefined') {
    return DEFAULT_BRANCHES;
  }
  try {
    const stored = window.localStorage.getItem(BRANCH_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Branch[];
      if (Array.isArray(parsed) && parsed.length) {
        return parsed;
      }
    }
  } catch {
    // fall back to defaults
  }
  return DEFAULT_BRANCHES;
}

function persistBranches() {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(BRANCH_STORAGE_KEY, JSON.stringify(branchState));
  }
}

function readSelectedBranchId() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const stored = window.localStorage.getItem(SELECTED_BRANCH_STORAGE_KEY);
  return stored || undefined;
}

function persistSelectedBranchId() {
  if (typeof window !== 'undefined') {
    if (selectedBranchId) {
      window.localStorage.setItem(SELECTED_BRANCH_STORAGE_KEY, selectedBranchId);
    } else {
      window.localStorage.removeItem(SELECTED_BRANCH_STORAGE_KEY);
    }
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

branchState = loadBranches();
selectedBranchId = readSelectedBranchId();

export function getBranches(): Branch[] {
  return branchState;
}

export function getBranchById(branchId?: string | null): Branch | undefined {
  if (!branchId) return undefined;
  return branchState.find((branch) => branch.id === branchId);
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
  persistSelectedBranchId();
  emit();
}

export function addBranch(data: Omit<Branch, 'id' | 'createdAt'>): Branch {
  const newBranch: Branch = {
    ...data,
    id: `branch_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  branchState = [newBranch, ...branchState];
  persistBranches();
  emit();
  return newBranch;
}

export function updateBranch(branchId: string, updates: Partial<Branch>) {
  branchState = branchState.map((branch) => (branch.id === branchId ? { ...branch, ...updates } : branch));
  persistBranches();
  emit();
}

export function toggleBranchStatus(branchId: string) {
  branchState = branchState.map((branch) =>
    branch.id === branchId ? { ...branch, status: branch.status === 'Active' ? 'Inactive' : 'Active' } : branch
  );
  persistBranches();
  emit();
}

export function deleteBranch(branchId: string) {
  branchState = branchState.filter((branch) => branch.id !== branchId);
  if (selectedBranchId === branchId) {
    selectedBranchId = undefined;
    persistSelectedBranchId();
  }
  persistBranches();
  emit();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
