CREATE TYPE "user_role" AS ENUM ('admin', 'viewer');

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "orgs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead_time_days_default" DECIMAL(65,30),
    "contact" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog" (
    "org_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "uom" TEXT,
    "shelf_life_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_pkey" PRIMARY KEY ("org_id","sku")
);

-- CreateTable
CREATE TABLE "sales_events" (
    "org_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "order_datetime" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(65,30),
    "discount_amount" DECIMAL(65,30),
    "net_amount" DECIMAL(65,30),
    "tax_amount" DECIMAL(65,30),
    "currency" TEXT DEFAULT 'UAH',
    "warehouse_id" TEXT,
    "channel" TEXT,
    "status" TEXT,
    "returned_qty" DECIMAL(65,30) DEFAULT 0,
    "canceled_qty" DECIMAL(65,30) DEFAULT 0,
    "promo_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_events_pkey" PRIMARY KEY ("org_id","order_id","line_id")
);

-- CreateTable
CREATE TABLE "sales_daily" (
    "org_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ALL',
    "units" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_daily_pkey" PRIMARY KEY ("org_id","date","sku","warehouse_id","channel")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "qty_on_hand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "batch_id" TEXT NOT NULL DEFAULT '_default',
    "expiry_date" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "org_id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "ordered_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("org_id","po_id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "org_id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL,
    "moq" INTEGER,
    "pack_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("org_id","po_id","sku")
);

-- CreateTable
CREATE TABLE "lead_time_stats" (
    "org_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "lead_time_days_median" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sample_size" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_time_stats_pkey" PRIMARY KEY ("org_id","supplier_id","sku")
);

-- CreateTable
CREATE TABLE "buffers" (
    "org_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "lead_time_days" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avg_daily_demand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "buffer_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "red_th" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "yellow_th" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buffers_pkey" PRIMARY KEY ("org_id","sku","warehouse_id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sku" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "target" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "on_hand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inbound" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "suggested_qty" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_api_key_key" ON "orgs"("api_key");

-- CreateIndex
CREATE INDEX "sales_events_datetime_idx" ON "sales_events"("order_datetime");

-- CreateIndex
CREATE INDEX "sales_daily_date_sku_idx" ON "sales_daily"("date", "sku", "warehouse_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshot_org_date_sku_wh_batch_idx" ON "stock_snapshots"("org_id", "date", "sku", "warehouse_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog" ADD CONSTRAINT "catalog_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
