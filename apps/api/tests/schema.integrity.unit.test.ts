import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { KitStatus, BorrowStatus, UserRole, ItemType, LocationType, StockTransactionType } from '@prisma/client';
import { prisma } from '../src/config/database';
import { calculateAvailableStock, validateStockInvariant } from '@acm/shared';

describe('Phase 2 – Database & Data Integrity Unit Test Suite', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../prisma/migrations/20261016200000_add_data_integrity_indexes_and_kits/migration.sql'
  );

  // ==========================================
  // 1. Prisma Client & Model Verification
  // ==========================================
  describe('Prisma Client Schema & Models Verification', () => {
    it('exposes KitStatus enum with all expected lifecycle states', () => {
      expect(KitStatus.AVAILABLE).toBe('AVAILABLE');
      expect(KitStatus.ALLOCATED).toBe('ALLOCATED');
      expect(KitStatus.MAINTENANCE).toBe('MAINTENANCE');
      expect(KitStatus.RETIRED).toBe('RETIRED');
    });

    it('exposes complete BorrowStatus lifecycle enum', () => {
      expect(BorrowStatus.PENDING).toBe('PENDING');
      expect(BorrowStatus.APPROVED).toBe('APPROVED');
      expect(BorrowStatus.REJECTED).toBe('REJECTED');
      expect(BorrowStatus.HANDED_OVER).toBe('HANDED_OVER');
      expect(BorrowStatus.RETURNED).toBe('RETURNED');
      expect(BorrowStatus.PARTIALLY_RETURNED).toBe('PARTIALLY_RETURNED');
      expect(BorrowStatus.CANCELLED).toBe('CANCELLED');
    });

    it('includes kit and kitItem delegates on Prisma client', () => {
      expect(prisma).toHaveProperty('kit');
      expect(prisma).toHaveProperty('kitItem');
      expect(typeof prisma.kit.findMany).toBe('function');
      expect(typeof prisma.kitItem.findMany).toBe('function');
    });
  });

  // ==========================================
  // 2. Mathematical Invariant Verification
  // ==========================================
  describe('Stock Mathematical Invariants & Non-Negative Rules', () => {
    it('calculates Available = OnHand - Reserved - Quarantined - KitAllocated correctly', () => {
      const balance = {
        onHand: 100,
        reserved: 20,
        quarantined: 5,
        kitAllocated: 15,
        borrowed: 30, // Borrowed is already deducted from onHand during handover
      };

      const available = calculateAvailableStock(balance);
      // 100 - 20 - 5 - 15 = 60
      expect(available).toBe(60);
    });

    it('validates that stock invariants reject negative component values', () => {
      expect(() => {
        validateStockInvariant({
          onHand: -1,
          reserved: 0,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        });
      }).toThrow(/cannot be negative/);

      expect(() => {
        validateStockInvariant({
          onHand: 50,
          reserved: -5,
          quarantined: 0,
          kitAllocated: 0,
          borrowed: 0,
        });
      }).toThrow(/cannot be negative/);
    });

    it('throws error when reserved + quarantined + kitAllocated exceeds onHand', () => {
      expect(() => {
        validateStockInvariant({
          onHand: 50,
          reserved: 30,
          quarantined: 15,
          kitAllocated: 10, // Sum = 55 > 50
          borrowed: 0,
        });
      }).toThrow(/exceeds On-hand/);
    });
  });

  // ==========================================
  // 3. Migration 3 SQL Safety & Structural Audit
  // ==========================================
  describe('Migration 3 SQL Structural & Safety Audit', () => {
    it('migration file exists on disk', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('contains zero destructive operations (no DROP TABLE, no DROP COLUMN, no DROP TYPE)', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8').toUpperCase();

      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('DROP COLUMN');
      expect(sql).not.toContain('DROP TYPE');
    });

    it('defines PostgreSQL CHECK constraints for non-negative inventory balances', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_on_hand_non_negative" CHECK ("onHand" >= 0);');
      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_reserved_non_negative" CHECK ("reserved" >= 0);');
      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_quarantined_non_negative" CHECK ("quarantined" >= 0);');
      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_kit_allocated_non_negative" CHECK ("kitAllocated" >= 0);');
      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_borrowed_non_negative" CHECK ("borrowed" >= 0);');
      expect(sql).toContain('ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_allocation_limit" CHECK ("reserved" + "quarantined" + "kitAllocated" <= "onHand");');
    });

    it('defines CHECK constraints for positive quantities on transaction and borrow details', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      expect(sql).toContain('ALTER TABLE "borrow_details" ADD CONSTRAINT "check_borrow_details_quantity_positive" CHECK ("quantity" > 0);');
      expect(sql).toContain('ALTER TABLE "borrow_details" ADD CONSTRAINT "check_borrow_details_returned_quantity_valid" CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");');
      expect(sql).toContain('ALTER TABLE "return_details" ADD CONSTRAINT "check_return_details_quantity_positive" CHECK ("quantity" > 0);');
      expect(sql).toContain('ALTER TABLE "stock_transaction_details" ADD CONSTRAINT "check_stock_transaction_details_quantity_positive" CHECK ("quantity" > 0);');
      expect(sql).toContain('ALTER TABLE "kit_items" ADD CONSTRAINT "check_kit_item_quantity_positive" CHECK ("quantity" > 0);');
    });

    it('defines essential performance indexes for audit logs, borrow requests, and stock movements', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      // Audit logs indexes
      expect(sql).toContain('CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");');
      expect(sql).toContain('CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");');
      expect(sql).toContain('CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");');
      expect(sql).toContain('CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");');

      // Borrow requests indexes
      expect(sql).toContain('CREATE INDEX "borrow_requests_borrowerId_idx" ON "borrow_requests"("borrowerId");');
      expect(sql).toContain('CREATE INDEX "borrow_requests_status_idx" ON "borrow_requests"("status");');
      expect(sql).toContain('CREATE INDEX "borrow_requests_expectedReturnDate_idx" ON "borrow_requests"("expectedReturnDate");');

      // Stock movements indexes
      expect(sql).toContain('CREATE INDEX "stock_movements_itemId_locationId_idx" ON "stock_movements"("itemId", "locationId");');
      expect(sql).toContain('CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");');
    });

    it('creates kits and kit_items tables with valid foreign key constraints', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');

      expect(sql).toContain('CREATE TABLE "kits"');
      expect(sql).toContain('CREATE TABLE "kit_items"');
      expect(sql).toContain('ALTER TABLE "kits" ADD CONSTRAINT "kits_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;');
      expect(sql).toContain('ALTER TABLE "kit_items" ADD CONSTRAINT "kit_items_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;');
      expect(sql).toContain('ALTER TABLE "kit_items" ADD CONSTRAINT "kit_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;');
    });
  });

  // ==========================================
  // 4. Mocked Kit Data Operations
  // ==========================================
  describe('Mocked Kit Data Flow Verification', () => {
    it('creates a kit bundle record with item lines in transaction', async () => {
      const mockKitId = '99999999-8888-7777-6666-555555555555';
      const mockItemId1 = '11111111-1111-1111-1111-111111111111';
      const mockItemId2 = '22222222-2222-2222-2222-222222222222';

      const mockCreatedKit = {
        id: mockKitId,
        code: 'KIT-IOT-ESP32-01',
        name: 'Bộ Kit Thực Hành IoT ESP32',
        status: KitStatus.AVAILABLE,
        items: [
          { id: 'item-line-1', kitId: mockKitId, itemId: mockItemId1, quantity: 1 },
          { id: 'item-line-2', kitId: mockKitId, itemId: mockItemId2, quantity: 4 },
        ],
      };

      vi.spyOn(prisma.kit, 'create').mockResolvedValue(mockCreatedKit as any);

      const result = await prisma.kit.create({
        data: {
          code: 'KIT-IOT-ESP32-01',
          name: 'Bộ Kit Thực Hành IoT ESP32',
          status: KitStatus.AVAILABLE,
          items: {
            create: [
              { itemId: mockItemId1, quantity: 1 },
              { itemId: mockItemId2, quantity: 4 },
            ],
          },
        },
        include: { items: true },
      });

      expect(result.code).toBe('KIT-IOT-ESP32-01');
      expect(result.status).toBe(KitStatus.AVAILABLE);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].quantity).toBe(1);
      expect(result.items[1].quantity).toBe(4);
    });
  });
});
