-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('AVAILABLE', 'ALLOCATED', 'MAINTENANCE', 'RETIRED');

-- CreateTable
CREATE TABLE "kits" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "KitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "locationId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_items" (
    "id" UUID NOT NULL,
    "kitId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kit_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Kits
CREATE UNIQUE INDEX "kits_code_key" ON "kits"("code");
CREATE INDEX "kits_locationId_idx" ON "kits"("locationId");
CREATE INDEX "kits_createdById_idx" ON "kits"("createdById");
CREATE INDEX "kits_status_idx" ON "kits"("status");

-- CreateIndex: KitItems
CREATE UNIQUE INDEX "kit_items_kitId_itemId_key" ON "kit_items"("kitId", "itemId");
CREATE INDEX "kit_items_kitId_idx" ON "kit_items"("kitId");
CREATE INDEX "kit_items_itemId_idx" ON "kit_items"("itemId");

-- AddForeignKey: Kits
ALTER TABLE "kits" ADD CONSTRAINT "kits_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kits" ADD CONSTRAINT "kits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: KitItems
ALTER TABLE "kit_items" ADD CONSTRAINT "kit_items_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kit_items" ADD CONSTRAINT "kit_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: KitItems quantity must be positive
ALTER TABLE "kit_items" ADD CONSTRAINT "check_kit_item_quantity_positive" CHECK ("quantity" > 0);

-- =========================================================================
-- INDEXES FOR PERFORMANCE, FILTERING AND FOREIGN KEY LOOKUPS
-- =========================================================================

-- Users
CREATE INDEX "users_roleId_idx" ON "users"("roleId");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_isActive_isLocked_idx" ON "users"("isActive", "isLocked");

-- Categories
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- Items
CREATE INDEX "items_categoryId_idx" ON "items"("categoryId");
CREATE INDEX "items_type_idx" ON "items"("type");
CREATE INDEX "items_isActive_idx" ON "items"("isActive");

-- Locations
CREATE INDEX "locations_parentId_idx" ON "locations"("parentId");
CREATE INDEX "locations_type_idx" ON "locations"("type");
CREATE INDEX "locations_isActive_idx" ON "locations"("isActive");

-- Assets
CREATE INDEX "assets_itemId_idx" ON "assets"("itemId");
CREATE INDEX "assets_locationId_idx" ON "assets"("locationId");
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- StockBalances
CREATE INDEX "stock_balances_locationId_idx" ON "stock_balances"("locationId");
CREATE INDEX "stock_balances_itemId_idx" ON "stock_balances"("itemId");

-- StockMovements
CREATE INDEX "stock_movements_itemId_locationId_idx" ON "stock_movements"("itemId", "locationId");
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");
CREATE INDEX "stock_movements_createdById_idx" ON "stock_movements"("createdById");
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- StockReservations
CREATE INDEX "stock_reservations_borrowRequestId_idx" ON "stock_reservations"("borrowRequestId");
CREATE INDEX "stock_reservations_itemId_locationId_idx" ON "stock_reservations"("itemId", "locationId");
CREATE INDEX "stock_reservations_status_idx" ON "stock_reservations"("status");

-- StockTransactions
CREATE INDEX "stock_transactions_createdById_idx" ON "stock_transactions"("createdById");
CREATE INDEX "stock_transactions_type_idx" ON "stock_transactions"("type");
CREATE INDEX "stock_transactions_createdAt_idx" ON "stock_transactions"("createdAt");

-- StockTransactionDetails
CREATE INDEX "stock_transaction_details_stockTransactionId_idx" ON "stock_transaction_details"("stockTransactionId");
CREATE INDEX "stock_transaction_details_itemId_idx" ON "stock_transaction_details"("itemId");
CREATE INDEX "stock_transaction_details_locationId_idx" ON "stock_transaction_details"("locationId");
CREATE INDEX "stock_transaction_details_to_location_id_idx" ON "stock_transaction_details"("to_location_id");

-- BorrowRequests
CREATE INDEX "borrow_requests_borrowerId_idx" ON "borrow_requests"("borrowerId");
CREATE INDEX "borrow_requests_approverId_idx" ON "borrow_requests"("approverId");
CREATE INDEX "borrow_requests_status_idx" ON "borrow_requests"("status");
CREATE INDEX "borrow_requests_expectedReturnDate_idx" ON "borrow_requests"("expectedReturnDate");

-- BorrowDetails
CREATE INDEX "borrow_details_borrowRequestId_idx" ON "borrow_details"("borrowRequestId");
CREATE INDEX "borrow_details_itemId_idx" ON "borrow_details"("itemId");
CREATE INDEX "borrow_details_assetId_idx" ON "borrow_details"("assetId");

-- ReturnTransactions
CREATE INDEX "return_transactions_borrowRequestId_idx" ON "return_transactions"("borrowRequestId");
CREATE INDEX "return_transactions_receiverId_idx" ON "return_transactions"("receiverId");
CREATE INDEX "return_transactions_createdAt_idx" ON "return_transactions"("createdAt");

-- ReturnDetails
CREATE INDEX "return_details_returnTransactionId_idx" ON "return_details"("returnTransactionId");
CREATE INDEX "return_details_itemId_idx" ON "return_details"("itemId");
CREATE INDEX "return_details_assetId_idx" ON "return_details"("assetId");

-- AuditLogs
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- =========================================================================
-- DATABASE CHECK CONSTRAINTS FOR MATHEMATICAL INVARIANTS & INTEGRITY
-- =========================================================================

-- Non-negative stock balance invariants
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_on_hand_non_negative" CHECK ("onHand" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_reserved_non_negative" CHECK ("reserved" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_quarantined_non_negative" CHECK ("quarantined" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_kit_allocated_non_negative" CHECK ("kitAllocated" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_borrowed_non_negative" CHECK ("borrowed" >= 0);

-- Inventory allocation rule: reserved + quarantined + kitAllocated <= onHand
ALTER TABLE "stock_balances" ADD CONSTRAINT "check_stock_balances_allocation_limit" CHECK ("reserved" + "quarantined" + "kitAllocated" <= "onHand");

-- Detail quantities must be strictly positive
ALTER TABLE "borrow_details" ADD CONSTRAINT "check_borrow_details_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "borrow_details" ADD CONSTRAINT "check_borrow_details_returned_quantity_valid" CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");
ALTER TABLE "return_details" ADD CONSTRAINT "check_return_details_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_transaction_details" ADD CONSTRAINT "check_stock_transaction_details_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_reservations" ADD CONSTRAINT "check_stock_reservations_quantity_positive" CHECK ("quantity" > 0);

-- Stock movements consistency
ALTER TABLE "stock_movements" ADD CONSTRAINT "check_stock_movements_on_hand_before_non_negative" CHECK ("onHandBefore" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "check_stock_movements_on_hand_after_non_negative" CHECK ("onHandAfter" >= 0);
