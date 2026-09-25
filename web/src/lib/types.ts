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
};

export type Location = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  hourly_machine_rate: number;
  tax_rate: number;
  currency: string;
  is_active: boolean;
};

export type Material = {
  id: string;
  slug: string;
  name: Localized;
  adjective: Localized | null;
  density_g_cm3: number;
  default_flow_mm3_s: number;
  is_active: boolean;
  sort_order: number;
};

export type Filament = {
  id: string;
  material_id: string;
  color: Localized;
  color_hex: string | null;
  diameter: number;
  cost_per_gram: number;
  manufacturer: string | null;
  is_active: boolean;
};

export type PremadeProduct = {
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

export type ProductOptionGroup = {
  id: string;
  product_id: string;
  label: Localized;
  option_type: 'select_one' | 'select_many' | 'text' | 'file';
  required: boolean;
  sort_order: number;
};

export type ProductOptionChoice = {
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

export type CartLineInput = {
  kind: 'premade' | 'custom';
  product_id?: string;
  quote_request_id?: string;
  material_id?: string | null;
  color_filament_id?: string | null;
  quantity: number;
  options?: Record<string, unknown>;
};

export type Cart = {
  location_id: string | null;
  items: CartLineInput[];
};
