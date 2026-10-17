/** UI visibility only. Backend RBAC is authoritative.
 * The Users UI has mutation controls requiring ADMIN; LAB_MANAGER still has
 * backend directory-read access but no read-only Users UI in this MVP.
 * Business owner approval of this access matrix is pending.
 */
export type AppRole = 'ADMIN' | 'LAB_MANAGER' | 'TECHNICIAN' | 'STUDENT';
const ALL: readonly AppRole[] = ['ADMIN','LAB_MANAGER','TECHNICIAN','STUDENT'];
const OPERATORS: readonly AppRole[] = ['ADMIN','LAB_MANAGER','TECHNICIAN'];
export const PAGE_ACCESS: Record<string, readonly AppRole[]> = {
  '/dashboard': ALL,
  '/items': ALL,
  '/categories': ALL,
  '/kits': ALL,
  '/inventory': OPERATORS,
  '/transactions': OPERATORS,
  '/borrow-return': ALL,
  '/users': ['ADMIN'],
  '/reports': ['ADMIN'],
  '/audit-logs': ['ADMIN'],
  '/settings': ALL,
};
export function canAccessPage(role: string | null | undefined, path: string): boolean {
  return Boolean(role && PAGE_ACCESS[path]?.includes(role as AppRole));
}
export function canApproveBorrow(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'LAB_MANAGER';
}
export function canProcessHandoverOrReturn(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'LAB_MANAGER' || role === 'TECHNICIAN';
}
