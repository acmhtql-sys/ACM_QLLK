/** Stage4C/D7 regression: reject invalid borrow UUID before any SQL or Prisma transaction.
 * Pure unit test — database module is fully mocked; no PostgreSQL connection.
 */
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@acm/shared';
import { borrowService } from '../src/modules/borrow/borrow.service';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('../src/config/database', () => ({
  prisma: { $transaction: mocks.transaction },
}));

describe('D7 legacy return service input guard (no DB)', () => {
  it('D7-UUID-01: invalid borrow ID yields 422 before any transaction or raw SQL', async () => {
    vi.stubEnv('ACM_RETURN_OPERATIONS_ENABLED', 'false');
    try {
      const user = {
        id: '11111111-1111-4111-8111-111111111111',
        role: UserRole.TECHNICIAN,
        fullName: 'Test Technician',
        email: 'technician@example.test',
      };
      const input = {
        items: [{ borrowDetailId: '22222222-2222-4222-8222-222222222222',
          returnedQuantity: 1, condition: 'GOOD' }],
      };
      await expect(borrowService.returnBorrowRequest(
        'invalid-id', input as any, user as any, 'return_0123456789abcdef0123456789abcdef',
      )).rejects.toMatchObject({ statusCode: 422 });
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
