-- ============================================================================
-- demo_products.sql
-- Realistic sample catalog across every category, for demoing the Admin
-- Inventory + Dashboard and the public website catalog.
-- Safe to re-run: ON CONFLICT (sku) DO NOTHING skips rows already inserted.
-- Two rows are intentionally at/under their low-stock threshold so the
-- Dashboard "Low Stock Alerts" panel has something to show.
-- ============================================================================

insert into products
  (name, category, brand, model, sku, barcode, buyer_code,
   purchase_price, sale_price, stock_qty, min_stock_alert, description, is_active)
values
  -- Mobiles ------------------------------------------------------------------
  ('iPhone 15 (128GB)',          'Mobiles', 'Apple',   '15',          'MOB-APL-15',   '8901000000011', 'BC-APL15', 62000, 71999, 8,  3, 'A16 Bionic, 6.1" OLED, Dynamic Island', true),
  ('Redmi Note 13 Pro',          'Mobiles', 'Xiaomi',  'Note 13 Pro', 'MOB-XMI-N13P', '8901000000028', 'BC-N13P',  18500, 23999, 15, 4, '200MP camera, 120Hz AMOLED', true),
  ('OnePlus Nord CE 4',          'Mobiles', 'OnePlus', 'Nord CE 4',   'MOB-OP-NCE4',  '8901000000035', 'BC-NCE4',  21000, 26999, 6,  3, 'Snapdragon 7 Gen 3, 100W charging', true),
  ('Vivo T3 5G',                 'Mobiles', 'Vivo',    'T3 5G',       'MOB-VVO-T3',   '8901000000042', 'BC-VT3',   15500, 19499, 2,  4, '50MP Sony sensor, 5000mAh', true),

  -- TVs ----------------------------------------------------------------------
  ('Sony Bravia 55" 4K',         'TVs', 'Sony',    'KD-55X75L',    'TV-SNY-55X75', '8901000000059', 'BC-55X75', 52000, 64999, 5,  2, '4K HDR, Google TV', true),
  ('Samsung Crystal 43" 4K',     'TVs', 'Samsung', 'UA43CU7700',   'TV-SAM-43CU',  '8901000000066', 'BC-43CU',  28000, 36999, 7,  2, 'Crystal 4K, Tizen OS', true),
  ('LG 32" HD Ready',            'TVs', 'LG',      '32LM563',      'TV-LG-32LM',   '8901000000073', 'BC-32LM',  11000, 14499, 10, 3, 'HD Ready LED, webOS', true),

  -- ACs ----------------------------------------------------------------------
  ('Daikin 1.5T 3-Star Inverter','ACs', 'Daikin',  'FTKM50U',      'AC-DKN-15T3',  '8901000000080', 'BC-DKN15', 34000, 42999, 4,  2, '1.5 Ton, copper condenser, PM 2.5 filter', true),
  ('Voltas 1T 3-Star',           'ACs', 'Voltas',  '123 DZX',      'AC-VLT-1T3',   '8901000000097', 'BC-VLT1',  24000, 31499, 6,  2, '1 Ton fixed speed, high ambient cooling', true),

  -- Laptops ------------------------------------------------------------------
  ('HP Pavilion 14',             'Laptops', 'HP',     'Pavilion 14', 'LAP-HP-PAV14', '8901000000103', 'BC-PAV14', 48000, 58999, 5,  2, 'Intel i5 13th Gen, 16GB, 512GB SSD', true),
  ('Lenovo IdeaPad Slim 3',      'Laptops', 'Lenovo', 'Slim 3',      'LAP-LNV-SL3',  '8901000000110', 'BC-SL3',   38000, 46999, 4,  2, 'Ryzen 5, 8GB, 512GB SSD', true),
  ('Dell Inspiron 15',           'Laptops', 'Dell',   'Inspiron 15', 'LAP-DEL-IN15', '8901000000127', 'BC-IN15',  42000, 51999, 3,  2, 'Intel i5, 16GB, backlit keyboard', true),

  -- Accessories --------------------------------------------------------------
  ('boAt Airdopes 141',          'Accessories', 'boAt',      'Airdopes 141', 'ACC-BOAT-141', '8901000000134', 'BC-BA141', 900,  1499, 40, 8, 'TWS earbuds, 42H playback', true),
  ('Samsung 25W Charger',        'Accessories', 'Samsung',   'EP-TA800',     'ACC-SAM-25W',  '8901000000141', 'BC-25W',   950,  1699, 30, 8, 'USB-C super fast charging', true),
  ('Spigen Tough Armor Case',    'Accessories', 'Spigen',    'Tough Armor',  'ACC-SPG-TA',   '8901000000158', 'BC-SPGTA', 550,  1299, 25, 6, 'Rugged protection, kickstand', true),
  ('SanDisk 128GB microSD',      'Accessories', 'SanDisk',   'Ultra 128',    'ACC-SDK-128',  '8901000000165', 'BC-SD128', 700,  1199, 3,  6, 'A1, 140MB/s, Class 10', true),

  -- Gift Hampers -------------------------------------------------------------
  ('Diwali Gadget Hamper',       'Gift Hampers', 'Sai Combo', 'Diwali Pack', 'GFT-DIWALI-1', '8901000000172', 'BC-DIW1',  1800, 2999, 12, 3, 'Earbuds + charger + cable gift box', true),
  ('Premium Accessory Box',      'Gift Hampers', 'Sai Combo', 'Premium Box', 'GFT-PREM-1',   '8901000000189', 'BC-PREM1', 2500, 3999, 8,  3, 'Power bank + case + screen guard set', true)
on conflict (sku) do nothing;
