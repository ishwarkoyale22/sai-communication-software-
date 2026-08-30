-- ============================================================================
-- 0015_website_integration_bridge.sql
-- Bridges the Website and Admin/Staff Software schemas on the shared Supabase.
-- Safe to run on ANY database state: checks column existence dynamically.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRODUCTS: Ensure both `price` (Website) and `sale_price` (Software) exist
-- ----------------------------------------------------------------------------

-- Add sale_price and purchase_price (used by Admin/Staff software)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sale_price numeric(12,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS purchase_price numeric(12,2) NOT NULL DEFAULT 0;

-- Add price (used by Website)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric(12,2);

-- Safely sync existing values between sale_price and price
DO $$
BEGIN
  -- If sale_price is null, copy from price
  UPDATE public.products
  SET sale_price = COALESCE(price, 0)
  WHERE sale_price IS NULL;

  -- If price is null, copy from sale_price
  UPDATE public.products
  SET price = COALESCE(sale_price, 0)
  WHERE price IS NULL;
END $$;

-- Set NOT NULL and DEFAULT on both columns
ALTER TABLE public.products ALTER COLUMN sale_price SET DEFAULT 0;
ALTER TABLE public.products ALTER COLUMN sale_price SET NOT NULL;
ALTER TABLE public.products ALTER COLUMN price SET DEFAULT 0;
ALTER TABLE public.products ALTER COLUMN price SET NOT NULL;

-- Two-way price sync trigger: updating either `sale_price` or `price` updates the other
CREATE OR REPLACE FUNCTION public.sync_product_prices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    NEW.price := NEW.sale_price;
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    NEW.sale_price := NEW.price;
  ELSIF NEW.sale_price IS NULL AND NEW.price IS NOT NULL THEN
    NEW.sale_price := NEW.price;
  ELSIF NEW.price IS NULL AND NEW.sale_price IS NOT NULL THEN
    NEW.price := NEW.sale_price;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_prices ON public.products;
CREATE TRIGGER trg_sync_product_prices
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_prices();

-- ----------------------------------------------------------------------------
-- 2. PRODUCTS: Ensure `image_url` (Software) and `images` (Website) exist & sync
-- ----------------------------------------------------------------------------

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Populate images from image_url if images is empty
UPDATE public.products
SET images = jsonb_build_array(image_url)
WHERE image_url IS NOT NULL AND image_url <> '' AND (images IS NULL OR images = '[]'::jsonb);

-- Populate image_url from images[0] if image_url is empty
UPDATE public.products
SET image_url = images ->> 0
WHERE (image_url IS NULL OR image_url = '') AND images IS NOT NULL AND images <> '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.sync_product_images()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.image_url IS NOT NULL AND NEW.image_url <> '' AND (NEW.images IS NULL OR NEW.images = '[]'::jsonb) THEN
    NEW.images := jsonb_build_array(NEW.image_url);
  ELSIF NEW.images IS NOT NULL AND NEW.images <> '[]'::jsonb AND (NEW.image_url IS NULL OR NEW.image_url = '') THEN
    NEW.image_url := NEW.images ->> 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_images ON public.products;
CREATE TRIGGER trg_sync_product_images
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_images();

-- ----------------------------------------------------------------------------
-- 3. PRODUCTS: Ensure inventory and display columns exist
-- ----------------------------------------------------------------------------

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_qty integer NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS min_stock_alert integer NOT NULL DEFAULT 3;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'in_stock';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS finance_available boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS warranty text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS colors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS original_price numeric(12,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS buyer_code text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_gift_hamper boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hamper_item_ids uuid[] DEFAULT '{}';

-- Recalculate stock_status
UPDATE public.products SET stock_status =
  CASE
    WHEN stock_qty = 0 THEN 'out_of_stock'
    WHEN stock_qty <= min_stock_alert THEN 'low_stock'
    ELSE 'in_stock'
  END;

CREATE OR REPLACE FUNCTION public.sync_product_stock_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.stock_status :=
    CASE
      WHEN NEW.stock_qty = 0 THEN 'out_of_stock'
      WHEN NEW.stock_qty <= COALESCE(NEW.min_stock_alert, 3) THEN 'low_stock'
      ELSE 'in_stock'
    END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_stock_status ON public.products;
CREATE TRIGGER trg_sync_product_stock_status
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_status();

-- ----------------------------------------------------------------------------
-- 4. ENQUIRIES: Add columns used by Website enquiry inserts
-- ----------------------------------------------------------------------------

ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS product_interest text;
ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS product_name text;

-- ----------------------------------------------------------------------------
-- 5. ORDERS / ORDER_ITEMS / PAYMENTS: Grant Admin read + update permissions
-- ----------------------------------------------------------------------------

GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT UPDATE (order_status, delivery_status, internal_notes) ON public.orders TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='Admin can view all orders') THEN
    CREATE POLICY "Admin can view all orders" ON public.orders FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders' AND policyname='Admin can update order status') THEN
    CREATE POLICY "Admin can update order status" ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_items' AND policyname='Admin can view order items') THEN
    CREATE POLICY "Admin can view order items" ON public.order_items FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='Admin can view payments') THEN
    CREATE POLICY "Admin can view payments" ON public.payments FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. REPAIR_ENQUIRIES: Grant Admin read/update permissions
-- ----------------------------------------------------------------------------

GRANT SELECT ON public.repair_enquiries TO authenticated;
GRANT UPDATE (status, admin_notes) ON public.repair_enquiries TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='repair_enquiries' AND policyname='Admin can view repair enquiries') THEN
    CREATE POLICY "Admin can view repair enquiries" ON public.repair_enquiries FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='repair_enquiries' AND policyname='Admin can update repair enquiries') THEN
    CREATE POLICY "Admin can update repair enquiries" ON public.repair_enquiries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. PRODUCTS: Public Read Access Policy
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='products' AND policyname='Public can view active products') THEN
    CREATE POLICY "Public can view active products" ON public.products FOR SELECT TO anon, authenticated USING (is_active = true);
  END IF;
END $$;
