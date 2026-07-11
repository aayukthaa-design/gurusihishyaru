import type { Allocation } from '../pages/ClassAllocation';

// Try to update allocation on backend; fallback to in-memory
export async function updateAllocationAPI(allocation: Allocation) {
  try {
    const res = await fetch(`/api/allocations/${allocation.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allocation),
    });
    if (!res.ok) throw new Error('Server error');
    return true;
  } catch (e) {
    // No backend available — return false to indicate fallback
    return false;
  }
}

export async function removeAllocationAPI(id: string) {
  try {
    const res = await fetch(`/api/allocations/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Server error');
    return true;
  } catch (e) {
    return false;
  }
}
