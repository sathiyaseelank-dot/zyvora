import { Kysely, PostgresDialect, type Generated } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
    }),
  }),
});

// Type-safe database interface
export interface Database {
  // Catalog tables
  users: UserTable;
  roles: RoleTable;
  categories: CategoryTable;
  products: ProductTable;
  product_images: ProductImageTable;

  // Commerce tables
  inventory: InventoryTable;
  carts: CartTable;
  cart_items: CartItemTable;
  addresses: AddressTable;
  password_reset_tokens: PasswordResetTokenTable;

  // Order & Payment tables
  orders: OrderTable;
  order_items: OrderItemTable;
  payments: PaymentTable;
  refunds: RefundTable;
  shipments: ShipmentTable;

  // Engagement & Audit tables
  reviews: ReviewTable;
  coupons: CouponTable;
  audit_logs: AuditLogTable;
  banners: BannerTable;
  content_blocks: ContentBlockTable;
}

// Table type definitions (for Kysely type safety)
export interface UserTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string | null;
  mobile: string | null;
  role_id: string;
  /**
   * Sessions issued before this instant are rejected. Set on a password reset
   * so a stolen cookie stops working (migration 004).
   */
  session_invalid_before: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RoleTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  created_at: Generated<Date>;
}

export interface CategoryTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  created_at: Generated<Date>;
}

export interface ProductTable {
  id: Generated<string>;
  name: string;
  description: string;
  category_id: string;
  price: number; // INR rupees, integer
  compare_at_price: number | null; // Strike-through comparison price (ZYV-78)
  image: string; // single image URL
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProductImageTable {
  id: Generated<string>;
  product_id: string;
  url: string;
  alt_text: string | null;
  display_order: number;
  created_at: Generated<Date>;
}

export interface InventoryTable {
  id: Generated<string>;
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CartTable {
  id: Generated<string>;
  user_id: string | null;
  session_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CartItemTable {
  id: Generated<string>;
  cart_id: string;
  product_id: string;
  quantity: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AddressTable {
  id: Generated<string>;
  user_id: string | null;
  full_name: string;
  mobile: string;
  email: string;
  house_number_and_street: string;
  area: string;
  landmark: string | null;
  city: string;
  state: string;
  pin_code: string;
  country: string;
  delivery_instructions: string | null;
  is_default: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PasswordResetTokenTable {
  id: Generated<string>;
  user_id: string;
  /** Argon2id hash of the token — the raw token is never stored. */
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  ip_address: string | null;
  created_at: Generated<Date>;
}

export interface OrderTable {
  id: Generated<string>;
  user_id: string;
  checkout_session_id: string;
  shipping_address_id: string | null;
  shipping_address_snapshot: any | null;
  cancel_reason: string | null;
  cancelled_at: Date | null;
  return_reason: string | null;
  return_requested_at: Date | null;
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderItemTable {
  id: Generated<string>;
  order_id: string;
  product_id: string;
  name: string; // snapshot
  unit_price: number; // snapshot (INR rupees)
  quantity: number;
  created_at: Generated<Date>;
}

export interface PaymentTable {
  id: Generated<string>;
  order_id: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RefundTable {
  id: Generated<string>;
  payment_id: string;
  amount: number;
  reason: string;
  status: string;
  created_at: Generated<Date>;
}

export interface ShipmentTable {
  id: Generated<string>;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  shipped_at: Date | null;
  delivered_at: Date | null;
  created_at: Generated<Date>;
}

export interface ReviewTable {
  id: Generated<string>;
  product_id: string;
  user_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_verified_purchase: boolean;
  created_at: Generated<Date>;
}

export interface CouponTable {
  id: Generated<string>;
  code: string;
  discount_type: string;
  discount_value: number;
  min_order_amount: number | null;
  max_discount: number | null;
  usage_limit: number | null;
  used_count: number;
  starts_at: Date;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Generated<Date>;
}

export interface AuditLogTable {
  id: Generated<string>;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface BannerTable {
  id: Generated<string>;
  title: string;
  image_url: string;
  link_url: string | null;
  display_order: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContentBlockTable {
  id: Generated<string>;
  slug: string;
  title: string;
  body: string;
  updated_at: Generated<Date>;
}
