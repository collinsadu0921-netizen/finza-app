import { supabase } from "./supabaseClient"

export interface Rider {
  id: string
  business_id: string
  name: string
  phone: string
  vehicle_type: string
  commission_rate: number | null
  created_at: string
}

export interface Delivery {
  id: string
  rider_id: string
  business_id: string
  customer_name: string
  customer_phone: string
  pickup_location: string
  dropoff_location: string
  fee: number
  distance_km: number | null
  base_fee: number | null
  distance_fee: number | null
  total_fee: number | null
  payment_method: string
  status: string
  created_at: string
}

const getEffectiveFee = (delivery: { total_fee?: number | null; fee?: number | null }) =>
  Number(
    delivery.total_fee !== null && delivery.total_fee !== undefined
      ? delivery.total_fee
      : delivery.fee || 0
  )

export async function getRiders(business_id: string) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("business_id", business_id)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data as Rider[]
}

export async function createRider(payload: {
  business_id: string
  name: string
  phone: string
  vehicle_type: string
  commission_rate?: number | null
}) {
  const { data, error } = await supabase
    .from("riders")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Rider
}

export async function getDeliveries(business_id: string) {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .select(`
      *,
      riders (
        id,
        name
      )
    `)
    .eq("business_id", business_id)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data as any[]
}

export async function createDelivery(payload: {
  rider_id: string
  business_id: string
  customer_name: string
  customer_phone: string
  pickup_location: string
  dropoff_location: string
  fee: number
  payment_method: string
  status: string
  distance_km?: number | null
  base_fee?: number | null
  distance_fee?: number | null
  total_fee?: number | null
}) {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Delivery
}

export interface RiderStats {
  total_riders: number
  deliveries_today: number
  fees_today: number
}

export async function getRiderStats(business_id: string): Promise<RiderStats> {
  // Get total riders count
  const { count: ridersCount, error: ridersError } = await supabase
    .from("riders")
    .select("*", { count: "exact", head: true })
    .eq("business_id", business_id)

  if (ridersError) throw ridersError

  // Get today's deliveries
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data: todayDeliveries, error: deliveriesError } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)
    .gte("created_at", startOfDay.toISOString())

  if (deliveriesError) throw deliveriesError

  const deliveriesCount = todayDeliveries?.length || 0
  const feesToday = todayDeliveries?.reduce(
    (sum: number, d: any) => sum + Number(d.fee || 0),
    0
  ) || 0

  return {
    total_riders: ridersCount || 0,
    deliveries_today: deliveriesCount,
    fees_today: feesToday,
  }
}

export async function getRecentDeliveries(business_id: string, limit: number = 10) {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .select(`
      *,
      riders (
        id,
        name
      )
    `)
    .eq("business_id", business_id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as any[]
}

export interface DeliveryFilters {
  dateRange?: string
  startDate?: string
  endDate?: string
  rider_id?: string
  payment_method?: string
  status?: string
  search?: string
  page?: number
}

export interface FilteredDeliveriesResult {
  deliveries: any[]
  total_count: number
  page: number
  total_pages: number
}

export async function filterDeliveries(
  business_id: string,
  filters: DeliveryFilters
): Promise<FilteredDeliveriesResult> {
  const page = filters.page || 1
  const pageSize = 10
  const offset = (page - 1) * pageSize

  let query = supabase
    .from("rider_deliveries")
    .select(`
      *,
      riders (
        id,
        name
      )
    `, { count: "exact" })
    .eq("business_id", business_id)

  // Date filter
  if (filters.dateRange) {
    const now = new Date()
    const startOfDay = new Date(now.setHours(0, 0, 0, 0))
    
    switch (filters.dateRange) {
      case "today":
        query = query.gte("created_at", startOfDay.toISOString())
        break
      case "yesterday":
        const yesterday = new Date(startOfDay)
        yesterday.setDate(yesterday.getDate() - 1)
        const endOfYesterday = new Date(yesterday)
        endOfYesterday.setHours(23, 59, 59, 999)
        query = query.gte("created_at", yesterday.toISOString())
          .lte("created_at", endOfYesterday.toISOString())
        break
      case "this_week":
        const weekStart = new Date(startOfDay)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        query = query.gte("created_at", weekStart.toISOString())
        break
      case "this_month":
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        query = query.gte("created_at", monthStart.toISOString())
        break
    }
  }

  // Custom date range
  if (filters.startDate && filters.endDate) {
    query = query.gte("created_at", filters.startDate)
      .lte("created_at", filters.endDate)
  }

  // Rider filter
  if (filters.rider_id) {
    query = query.eq("rider_id", filters.rider_id)
  }

  // Payment method filter
  if (filters.payment_method && filters.payment_method !== "all") {
    query = query.eq("payment_method", filters.payment_method)
  }

  // Status filter
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status)
  }

  // Search filter
  if (filters.search) {
    query = query.or(
      `customer_name.ilike.%${filters.search}%,customer_phone.ilike.%${filters.search}%,pickup_location.ilike.%${filters.search}%,dropoff_location.ilike.%${filters.search}%`
    )
  }

  // Order and pagination
  query = query.order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1)

  const { data, error, count } = await query

  if (error) throw error

  const total_pages = Math.ceil((count || 0) / pageSize)

  return {
    deliveries: data || [],
    total_count: count || 0,
    page,
    total_pages,
  }
}

export async function updateDeliveryStatus(
  delivery_id: string,
  status: string
): Promise<Delivery> {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .update({ status })
    .eq("id", delivery_id)
    .select()
    .single()

  if (error) throw error
  return data as Delivery
}

export interface RiderBalance {
  rider_id: string
  name: string
  earned: number
  paid: number
  balance: number
}

export async function getRiderBalances(business_id: string): Promise<RiderBalance[]> {
  // Get all riders for this business
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("*")
    .eq("business_id", business_id)

  if (ridersError) throw ridersError

  // Get all completed deliveries
  const { data: deliveries, error: deliveriesError } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)
    .eq("status", "completed")

  if (deliveriesError) throw deliveriesError

  // Get all payouts
  const { data: payouts, error: payoutsError } = await supabase
    .from("rider_payouts")
    .select("*")
    .eq("business_id", business_id)

  if (payoutsError) throw payoutsError

  // Calculate balances per rider
  const balances: RiderBalance[] = (riders || []).map((rider) => {
    const riderDeliveries = (deliveries || []).filter((d) => d.rider_id === rider.id)
    
    // Calculate earned: if commission_rate is null, use full fee, else use fee * commission_rate
    const earned = riderDeliveries.reduce((sum, delivery) => {
      const fee = getEffectiveFee(delivery)
      if (rider.commission_rate === null) {
        return sum + fee
      } else {
        return sum + fee * Number(rider.commission_rate || 0)
      }
    }, 0)

    const riderPayouts = (payouts || []).filter((p) => p.rider_id === rider.id)
    const paid = riderPayouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0)

    return {
      rider_id: rider.id,
      name: rider.name,
      earned,
      paid,
      balance: earned - paid,
    }
  })

  return balances
}

export async function createPayout(payload: {
  business_id: string
  rider_id: string
  amount: number
  note?: string
}) {
  const { data, error } = await supabase
    .from("rider_payouts")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getRiderById(rider_id: string): Promise<Rider> {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", rider_id)
    .single()

  if (error) throw error
  return data as Rider
}

export async function updateRider(
  rider_id: string,
  fields: {
    name?: string
    phone?: string
    vehicle_type?: string
    commission_rate?: number | null
  }
): Promise<Rider> {
  const { data, error } = await supabase
    .from("riders")
    .update(fields)
    .eq("id", rider_id)
    .select()
    .single()

  if (error) throw error
  return data as Rider
}

export async function getDeliveryById(delivery_id: string) {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .select(`
      *,
      riders (
        id,
        name
      )
    `)
    .eq("id", delivery_id)
    .single()

  if (error) throw error
  return data
}

export async function updateDelivery(
  delivery_id: string,
  fields: {
    rider_id?: string
    customer_name?: string
    customer_phone?: string
    pickup_location?: string
    dropoff_location?: string
    fee?: number
    payment_method?: string
    status?: string
    distance_km?: number | null
    base_fee?: number | null
    distance_fee?: number | null
    total_fee?: number | null
  }
): Promise<Delivery> {
  const { data, error } = await supabase
    .from("rider_deliveries")
    .update(fields)
    .eq("id", delivery_id)
    .select()
    .single()

  if (error) throw error
  return data as Delivery
}

export interface DistanceTier {
  min_km: number
  max_km: number
  price: number
}

export async function updateBusinessRiderPricing(
  business_id: string,
  fields: {
    rider_base_fee?: number | null
    rider_price_per_km?: number | null
    rider_distance_tiers?: DistanceTier[] | null
  }
) {
  const { data, error } = await supabase
    .from("businesses")
    .update(fields)
    .eq("id", business_id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Helper to find matching tier for a distance
export function findMatchingTier(
  distance_km: number | null,
  tiers: DistanceTier[] | null
): DistanceTier | null {
  if (distance_km === null || !tiers || tiers.length === 0) return null

  return (
    tiers.find((tier) => distance_km >= tier.min_km && distance_km <= tier.max_km) || null
  )
}

// Helper to calculate delivery fee based on pricing model
export function calculateDeliveryFee(
  distance_km: number | null,
  base_fee: number | null,
  price_per_km: number | null,
  distance_tiers: DistanceTier[] | null,
  manual_fee: number | null
): {
  base_fee: number
  distance_fee: number
  total_fee: number
  pricing_model: "tier" | "per_km" | "manual"
  tier_info?: { min_km: number; max_km: number; price: number }
} {
  // If distance is provided and tiers exist, use tier pricing
  if (distance_km !== null && distance_tiers && distance_tiers.length > 0) {
    const tier = findMatchingTier(distance_km, distance_tiers)
    if (tier) {
      return {
        base_fee: tier.price,
        distance_fee: 0,
        total_fee: tier.price,
        pricing_model: "tier",
        tier_info: tier,
      }
    }
  }

  // Fall back to per-km model if distance and pricing settings exist
  if (
    distance_km !== null &&
    base_fee !== null &&
    price_per_km !== null &&
    base_fee >= 0 &&
    price_per_km >= 0
  ) {
    const distanceFee = distance_km * price_per_km
    return {
      base_fee,
      distance_fee: distanceFee,
      total_fee: base_fee + distanceFee,
      pricing_model: "per_km",
    }
  }

  // Fall back to manual fee
  const manual = manual_fee || 0
  return {
    base_fee: manual,
    distance_fee: 0,
    total_fee: manual,
    pricing_model: "manual",
  }
}

export interface BusinessDeliveryStats {
  total_deliveries: number
  total_completed: number
  total_fees: number
  average_fee: number
}

export async function getBusinessDeliveryStats(
  business_id: string
): Promise<BusinessDeliveryStats> {
  // Get all deliveries
  const { data: allDeliveries, error: allError } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)

  if (allError) throw allError

  const total_deliveries = allDeliveries?.length || 0

  // Get completed deliveries
  const completedDeliveries =
    allDeliveries?.filter((d) => d.status === "completed") || []

  const total_completed = completedDeliveries.length

  // Calculate total fees and average
  const total_fees = completedDeliveries.reduce(
    (sum, d) => sum + getEffectiveFee(d),
    0
  )

  const average_fee =
    total_completed > 0 ? total_fees / total_completed : 0

  return {
    total_deliveries,
    total_completed,
    total_fees,
    average_fee,
  }
}

export interface DeliveriesPerRider {
  rider_id: string
  rider_name: string
  completed_deliveries_count: number
  total_fees: number
  average_fee: number
  commission_rate: number | null
  earnings_after_commission: number
}

export async function getDeliveriesPerRider(
  business_id: string
): Promise<DeliveriesPerRider[]> {
  // Get all riders
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("*")
    .eq("business_id", business_id)

  if (ridersError) throw ridersError

  // Get all completed deliveries
  const { data: deliveries, error: deliveriesError } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)
    .eq("status", "completed")

  if (deliveriesError) throw deliveriesError

  // Calculate per rider
  const result: DeliveriesPerRider[] = (riders || []).map((rider) => {
    const riderDeliveries =
      deliveries?.filter((d) => d.rider_id === rider.id) || []

    const completed_deliveries_count = riderDeliveries.length
    const total_fees = riderDeliveries.reduce(
      (sum, d) => sum + getEffectiveFee(d),
      0
    )
    const average_fee =
      completed_deliveries_count > 0
        ? total_fees / completed_deliveries_count
        : 0

    // Calculate earnings after commission
    let earnings_after_commission = 0
    if (rider.commission_rate === null) {
      earnings_after_commission = total_fees
    } else {
      earnings_after_commission = total_fees * Number(rider.commission_rate || 0)
    }

    return {
      rider_id: rider.id,
      rider_name: rider.name,
      completed_deliveries_count,
      total_fees,
      average_fee,
      commission_rate: rider.commission_rate,
      earnings_after_commission,
    }
  })

  // Sort by completed deliveries DESC
  return result.sort(
    (a, b) => b.completed_deliveries_count - a.completed_deliveries_count
  )
}

export interface WeeklyDeliveryCount {
  date: string
  count: number
}

export async function getWeeklyDeliveryCounts(
  business_id: string
): Promise<WeeklyDeliveryCount[]> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const { data: deliveries, error } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)
    .eq("status", "completed")
    .gte("created_at", sevenDaysAgo.toISOString())

  if (error) throw error

  // Group by day
  const dayCounts: { [key: string]: number } = {}

  // Initialize last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    date.setHours(0, 0, 0, 0)
    const dateKey = date.toISOString().split("T")[0]
    dayCounts[dateKey] = 0
  }

  // Count deliveries per day
  deliveries?.forEach((delivery) => {
    const deliveryDate = new Date(delivery.created_at)
    deliveryDate.setHours(0, 0, 0, 0)
    const dateKey = deliveryDate.toISOString().split("T")[0]
    if (dayCounts[dateKey] !== undefined) {
      dayCounts[dateKey]++
    }
  })

  // Convert to array
  return Object.entries(dayCounts)
    .map(([date, count]) => ({
      date,
      count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface RiderEarningsChart {
  rider_name: string
  earnings: number
}

export async function getRiderEarningsChart(
  business_id: string
): Promise<RiderEarningsChart[]> {
  // Get all riders
  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select("*")
    .eq("business_id", business_id)

  if (ridersError) throw ridersError

  // Get all completed deliveries
  const { data: deliveries, error: deliveriesError } = await supabase
    .from("rider_deliveries")
    .select("*")
    .eq("business_id", business_id)
    .eq("status", "completed")

  if (deliveriesError) throw deliveriesError

  // Calculate earnings per rider
  const result: RiderEarningsChart[] = (riders || []).map((rider) => {
    const riderDeliveries =
      deliveries?.filter((d) => d.rider_id === rider.id) || []

    const total_fees = riderDeliveries.reduce(
      (sum, d) => sum + getEffectiveFee(d),
      0
    )

    // Calculate earnings after commission
    let earnings = 0
    if (rider.commission_rate === null) {
      earnings = total_fees
    } else {
      earnings = total_fees * Number(rider.commission_rate || 0)
    }

    return {
      rider_name: rider.name,
      earnings,
    }
  })

  // Sort by earnings DESC
  return result.sort((a, b) => b.earnings - a.earnings)
}

export interface RouteHeatmap {
  pickup_location: string
  dropoff_location: string
  count: number
}

export async function getRouteHeatmap(
  business_id: string
): Promise<RouteHeatmap[]> {
  const { data: deliveries, error } = await supabase
    .from("rider_deliveries")
    .select("pickup_location, dropoff_location")
    .eq("business_id", business_id)

  if (error) throw error

  // Group by route
  const routeCounts: { [key: string]: { pickup: string; dropoff: string; count: number } } = {}

  deliveries?.forEach((delivery) => {
    const key = `${delivery.pickup_location}|||${delivery.dropoff_location}`
    if (!routeCounts[key]) {
      routeCounts[key] = {
        pickup: delivery.pickup_location,
        dropoff: delivery.dropoff_location,
        count: 0,
      }
    }
    routeCounts[key].count++
  })

  // Convert to array and sort by count DESC
  return Object.values(routeCounts)
    .map((route) => ({
      pickup_location: route.pickup,
      dropoff_location: route.dropoff,
      count: route.count,
    }))
    .sort((a, b) => b.count - a.count)
}

