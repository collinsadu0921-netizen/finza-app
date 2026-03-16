-- Migration to convert old industry types to supported ones
-- Converts: salon, barber, beauty, spa, hair, restaurant, chopbar, food_service, canteen -> service
-- Keeps: retail, service, professional, logistics, rider (rider becomes logistics)

DO $$
BEGIN
  -- Convert old salon/barber/beauty industries to service
  UPDATE businesses
  SET industry = 'service'
  WHERE industry IN ('salon', 'barber', 'beauty', 'spa', 'hair', 'restaurant', 'chopbar', 'food_service', 'canteen');

  -- Convert rider to logistics (logistics is the new name for delivery/rider businesses)
  UPDATE businesses
  SET industry = 'logistics'
  WHERE industry = 'rider';

  -- Ensure no businesses have invalid industry values
  -- Set any remaining invalid industries to 'service' as default
  UPDATE businesses
  SET industry = 'service'
  WHERE industry NOT IN ('retail', 'service', 'professional', 'logistics', 'rider');

  RAISE NOTICE 'Converted old industry types to supported ones';
END $$;

