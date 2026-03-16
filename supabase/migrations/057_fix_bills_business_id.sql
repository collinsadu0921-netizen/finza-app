-- Fix Bills Table Structure - Ensure business_id exists and business_id_val does not
-- This migration ensures the bills table has the correct structure

-- Create temporary function to migrate business_id_val safely
CREATE OR REPLACE FUNCTION migrate_bills_business_id_val()
RETURNS void AS $$
BEGIN
  -- Check if business_id_val column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bills' AND column_name = 'business_id_val'
  ) THEN
    -- Migrate data using dynamic SQL
    EXECUTE format('
      UPDATE bills 
      SET business_id = business_id_val 
      WHERE business_id IS NULL 
        AND business_id_val IS NOT NULL
    ');
    
    -- Drop the incorrect column
    ALTER TABLE bills DROP COLUMN IF EXISTS business_id_val;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create temporary function to migrate bill_payments business_id_val safely
CREATE OR REPLACE FUNCTION migrate_bill_payments_business_id_val()
RETURNS void AS $$
BEGIN
  -- Check if business_id_val column exists and migrate data
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bill_payments' AND column_name = 'business_id_val'
  ) THEN
    -- Migrate data using dynamic SQL
    EXECUTE format('
      UPDATE bill_payments 
      SET business_id = business_id_val 
      WHERE business_id IS NULL 
        AND business_id_val IS NOT NULL
    ');
    
    -- Drop the incorrect column
    ALTER TABLE bill_payments DROP COLUMN IF EXISTS business_id_val;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Check if bills table exists and has correct structure
DO $$
BEGIN
  -- Ensure business_id column exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills') THEN
    -- Add business_id if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bills' AND column_name = 'business_id'
    ) THEN
      ALTER TABLE bills ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
      
      -- Update existing rows if any (set to first business or NULL)
      UPDATE bills SET business_id = (SELECT id FROM businesses LIMIT 1) WHERE business_id IS NULL;
      
      -- Make it NOT NULL after updating
      ALTER TABLE bills ALTER COLUMN business_id SET NOT NULL;
    END IF;

    -- Migrate business_id_val if it exists
    PERFORM migrate_bills_business_id_val();

    -- Ensure other required columns exist
    ALTER TABLE bills
      ADD COLUMN IF NOT EXISTS supplier_name TEXT,
      ADD COLUMN IF NOT EXISTS supplier_phone TEXT,
      ADD COLUMN IF NOT EXISTS supplier_email TEXT,
      ADD COLUMN IF NOT EXISTS bill_number TEXT,
      ADD COLUMN IF NOT EXISTS issue_date DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS due_date DATE,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS attachment_path TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

    -- Ensure NOT NULL constraints
    ALTER TABLE bills
      ALTER COLUMN supplier_name SET NOT NULL,
      ALTER COLUMN bill_number SET NOT NULL,
      ALTER COLUMN issue_date SET NOT NULL,
      ALTER COLUMN subtotal SET NOT NULL,
      ALTER COLUMN total SET NOT NULL;
  END IF;
END $$;

-- Ensure bill_items table has correct structure
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_items') THEN
    -- Ensure bill_id exists (should already exist)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_items' AND column_name = 'bill_id'
    ) THEN
      ALTER TABLE bill_items ADD COLUMN bill_id UUID REFERENCES bills(id) ON DELETE CASCADE;
    END IF;

    -- Remove any incorrect column references
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_items' AND column_name = 'billId'
    ) THEN
      ALTER TABLE bill_items DROP COLUMN "billId";
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_items' AND column_name = 'billID'
    ) THEN
      ALTER TABLE bill_items DROP COLUMN "billID";
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_items' AND column_name = 'bill_itemID'
    ) THEN
      ALTER TABLE bill_items DROP COLUMN "bill_itemID";
    END IF;

    -- Ensure required columns exist
    ALTER TABLE bill_items
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS qty NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS line_subtotal NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

    -- Ensure NOT NULL constraints
    ALTER TABLE bill_items
      ALTER COLUMN bill_id SET NOT NULL,
      ALTER COLUMN description SET NOT NULL,
      ALTER COLUMN qty SET NOT NULL,
      ALTER COLUMN unit_price SET NOT NULL,
      ALTER COLUMN line_subtotal SET NOT NULL;
  END IF;
END $$;

-- Ensure bill_payments table has correct structure
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_payments') THEN
    -- Ensure business_id exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_payments' AND column_name = 'business_id'
    ) THEN
      ALTER TABLE bill_payments ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
      
      -- Update existing rows
      UPDATE bill_payments bp
      SET business_id = (
        SELECT b.business_id FROM bills b WHERE b.id = bp.bill_id LIMIT 1
      )
      WHERE business_id IS NULL;
      
      ALTER TABLE bill_payments ALTER COLUMN business_id SET NOT NULL;
    END IF;

    -- Migrate business_id_val if it exists
    PERFORM migrate_bill_payments_business_id_val();

    -- Ensure bill_id exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bill_payments' AND column_name = 'bill_id'
    ) THEN
      ALTER TABLE bill_payments ADD COLUMN bill_id UUID REFERENCES bills(id) ON DELETE CASCADE;
      ALTER TABLE bill_payments ALTER COLUMN bill_id SET NOT NULL;
    END IF;

    -- Ensure required columns exist
    ALTER TABLE bill_payments
      ADD COLUMN IF NOT EXISTS amount NUMERIC,
      ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS method TEXT,
      ADD COLUMN IF NOT EXISTS reference TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

    -- Ensure NOT NULL constraints
    ALTER TABLE bill_payments
      ALTER COLUMN amount SET NOT NULL,
      ALTER COLUMN date SET NOT NULL,
      ALTER COLUMN method SET NOT NULL;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_bills_business_id ON bills(business_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_business_id ON bill_payments(business_id);

-- Clean up temporary functions
DROP FUNCTION IF EXISTS migrate_bills_business_id_val();
DROP FUNCTION IF EXISTS migrate_bill_payments_business_id_val();

