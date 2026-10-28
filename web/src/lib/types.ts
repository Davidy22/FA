// Generated-style types for DB rows (subset used by the client).
// We generate a minimal set by hand that matches the migration shape.

export type Localized = { en: string; 'zh-Hant'?: string; 'zh-Hans'?: string };

export type Profile = {
  id: string;
  email: string;
  role: 'customer' | 'employee' | 'manager' | 'admin';
  location_id: string | null;
  display_name: string | null;
  locale: 'en' | 'zh-Hant' | 'zh-Hans';
  is_creator: boolean;
  is_active: boolean;
  /** Module permissions granted to an employee/manager; admins hold all of them. */
  permissions: string[];
  points_balance: number;
  /** Points earned from orders over the lifetime of the account (never spent). */
  lifetime_points: number;
  referral_code: string;
  referred_by: string | null;
};

export type Coupon = {
  id: string;
  code: string;
  user_id: string | null;
  source: 'reward' | 'offer' | 'admin';
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  /** Cart subtotal the customer must reach before the coupon applies. */
  min_subtotal: number | null;
  /** When set, the coupon only discounts this product. */
  product_id: string | null;
  status: 'active' | 'used';
  expires_at: string | null;
  used_order_id: string | null;
  used_at: string | null;
  /** When set, using this coupon credits the buyer with this many points instead of a discount. */
  grant_points: number | null;
  created_at: string;
};

export type RewardTransaction = {
  id: string;
  user_id: string;
  points: number;
  type: 'order_earn' | 'redeem' | 'adjustment' | 'grant' | 'referral_signup' | 'referral_purchase';
  order_id: string | null;
  coupon_id: string | null;
  memo: string | null;
  created_at: string;
};

export type Location = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  photo_url: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  hourly_machine_rate: number;
  /** ISO 3166-1 alpha-2; drives whether sales tax applies at all. */
  country: string | null;
  tax_rate: number;
  currency: string;
  is_active: boolean;
};

export type Material = {
  id: string;
  slug: string;
  name: Localized;
  adjective: Localized | null;
  cost_per_gram: number;
  notes: string | null;
  density_g_cm3: number;
  default_flow_mm3_s: number;
  is_active: boolean;
};

export type Filament = {
  id: string;
  material_id: string;
  color: Localized;
  color_hex: string | null;
  /** Second colour for gradient/two-tone spools. */
  color_hex_2?: string | null;
  /** Finish slug: standard, matte, silk, wood, marble, gradient, glow, ... */
  finish: string;
  /** Joined finish row, when the query asks for it. */
  finish_name?: Localized | null;
  is_active: boolean;
};

/** An admin-managed product category (premade_products.category is this slug). */
export type ProductCategory = {
  slug: string;
  name: Localized;
  description: Localized | null;
  sort_order: number;
  is_active: boolean;
  parent_id: string | null;
};

/** An admin-managed filament finish, e.g. wood fill or silk. */
export type FilamentFinish = {
  slug: string;
  name: Localized;
  description: Localized | null;
  sort_order: number;
  is_active: boolean;
};

export type JobListing = {
  id: string;
  slug: string;
  title: Localized;
  summary: Localized | null;
  description: Localized | null;
  department: string | null;
  employment_type: 'full_time' | 'part_time' | 'contract' | 'internship';
  location_id: string | null;
  is_remote: boolean;
  is_published: boolean;
  sort_order: number;
  closes_at: string | null;
  created_at: string;
};

/** Sale pricing shared by products and option choices. */
export type SaleFields = {
  sale_price: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
};

export type PremadeProduct = SaleFields & {
  id: string;
  slug: string;
  name: Localized;
  description: Localized | null;
  base_price: number;
  default_material_id: string | null;
  category: 'toy' | 'tool' | 'art' | 'gadget' | 'replacement_part' | 'other';
  tags: string[];
  image_urls: string[];
  source_model_path: string;
  submitted_by: string | null;
  is_featured: boolean;
  status: 'draft' | 'published' | 'archived';
};

export type ProductMaterial = {
  product_id: string;
  material_id: string;
  price_modifier: number;
};

/** Product card rows include their materials in the same PostgREST request. */
export type ProductWithMaterials = PremadeProduct & {
  product_materials: (ProductMaterial & { material: Material | null })[];
};

/**
 * One named part of a multi-material print ("Body", "Wheels"). Each slot lists
 * the materials it can be printed in and the material/colour it defaults to.
 */
export type ProductMaterialSlot = {
  id: string;
  product_id: string;
  name: Localized;
  sort_order: number;
  default_material_id: string | null;
  default_filament_id: string | null;
  /** Another slot of the same product whose material/colour this slot copies. */
  linked_slot_id: string | null;
};

export type ProductSlotMaterial = {
  slot_id: string;
  material_id: string;
  price_modifier: number;
};

/** What the customer picked for one slot, sent to price_cart. */
export type SlotSelection = {
  material_id?: string | null;
  color_filament_id?: string | null;
};

/** A slot as price_cart resolved it; also what order_items.material_slots stores. */
export type PricedSlot = {
  slot_id: string;
  name: Localized;
  material: { id: string; slug: string; name: Localized; adjective: Localized | null };
  material_price_modifier: number;
  color: { id: string; color: Localized; color_hex: string | null } | null;
};

export type ProductOptionGroup = {
  id: string;
  product_id: string;
  label: Localized;
  option_type: 'select_one' | 'select_many' | 'text' | 'file';
  option_type_id: string | null;
  required: boolean;
  sort_order: number;
};

/** Shared localized labels for common option group names such as Size or Color. */
export type ProductOptionType = {
  id: string;
  slug: string;
  name: Localized;
  is_active: boolean;
  sort_order: number;
};

export type ProductOptionChoice = SaleFields & {
  id: string;
  group_id: string;
  label: Localized;
  price_modifier: number;
  sort_order: number;
};

export type TextOptionConfig = {
  group_id: string;
  max_length: number;
  price_modifier: number;
};

export type FileOptionConfig = {
  group_id: string;
  allowed_mime_types: string[];
  max_size_bytes: number;
  required: boolean;
};

export type QuoteRequest = {
  id: string;
  user_id: string | null;
  uploaded_model_id: string | null;
  material_id: string | null;
  filament_id: string | null;
  infill_percent: number;
  layer_height: number;
  quantity: number;
  engine: 'heuristic' | 'wasm' | 'remote';
  status: 'processing' | 'complete' | 'failed';
  estimated_price: number | null;
  price_breakdown: {
    material_cost: number;
    machine_cost: number;
    handling_fee: number;
    grams: number;
    print_time_min: number;
  } | null;
  material_usage_grams: number | null;
  print_time_minutes: number | null;
};

export type Ticket = {
  id: string;
  user_id: string;
  customer_name: string | null;
  customer_email: string | null;
  location_id: string | null;
  subject: string;
  status: 'open' | 'answered' | 'resolved';
  created_at: string;
  updated_at: string;
};

export type TicketMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string | null;
  author_role: 'customer' | 'employee' | 'manager' | 'admin';
  body: string;
  created_at: string;
};

export type TicketAttachment = {
  id: string;
  ticket_id: string;
  file_path: string;
  original_filename: string;
  file_size: number | null;
  uploaded_by: string;
  created_at: string;
};

export type TicketQuote = {
  id: string;
  ticket_id: string;
  staff_id: string;
  staff_name: string | null;
  description: string;
  unit_price: number;
  quantity: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'ordered';
  expires_at: string;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  staff?: { display_name: string | null };
};

export type Order = {
  id: string;
  order_number: string;
  user_id: string | null;
  location_id: string;
  contact_name: string | null;
  contact_email: string;
  locale: string;
  status: 'pending' | 'printing' | 'completed' | 'shipped' | 'cancelled' | 'refunded';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  tracking_number: string | null;
  cancel_reason: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
};

export type ModelSubmission = {
  id: string;
  submitter_id: string;
  status: 'draft' | 'pending_review' | 'changes_requested' | 'approved' | 'rejected' | 'disabled';
  title: Localized;
  description: Localized | null;
  category: string;
  tags: string[];
  license: string;
  model_path: string;
  preview_urls: string[];
  base_price: number;
  review_notes: string | null;
};

export type Payout = {
  id: string;
  creator_id: string;
  amount: number;
  status: 'requested' | 'processing' | 'paid' | 'rejected';
  method: 'manual' | 'stripe_connect';
  reference: string | null;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
};

export type OfferCode = {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_subtotal: number | null;
  product_id: string | null;
  max_claims: number | null;
  claims_count: number;
  coupon_valid_days: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
};

export type PlatformSetting = { key: string; value: unknown };

export type CartLineInput = {
  kind: 'premade' | 'custom' | 'document' | 'ticket';
  pages?: number;
  color?: 'grayscale' | 'color';
  duplex?: boolean;
  file_path?: string;
  product_id?: string;
  quote_request_id?: string;
  ticket_quote_id?: string;
  material_id?: string | null;
  color_filament_id?: string | null;
  /** Per-slot material/colour picks, keyed by product_material_slots.id. */
  slots?: Record<string, SlotSelection>;
  quantity: number;
  options?: Record<string, unknown>;
};
