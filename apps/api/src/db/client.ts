import { Kysely, PostgresDialect } from 'kysely';
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
}

// Table type definitions (for Kysely type safety)
export interface UserTable {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  mobile: string | null;
  role_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface RoleTable {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface CategoryTable {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
}

export interface ProductTable {
  id: string;
  name: string;
  description: string;
  category_id: string;
  price: number; // INR rupees, integer
  image: string; // single image URL
  stock_quantity: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ProductImageTable {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  display_order: number;
  created_at: Date;
}

export interface InventoryTable {
  id: string;
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  created_at: Date;
  updated_at: Date;
}

export interface CartTable {
  id: string;
  user_id: string | null;
  session_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CartItemTable {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number;
  created_at: Date;
  updated_at: Date;
}

export interface AddressTable {
  id: string;
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
  created_at: Date;
  updated_at: Date;
}

export interface OrderTable {
  id: string;
  user_id: string;
  checkout_session_id: string;
  subtotal: number;
  shipping: number;
  tax: number;
  discount: number;
  total: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemTable {
  id: string;
  order_id: string;
  product_id: string;
  name: string; // snapshot
  unit_price: number; // snapshot (INR rupees)
  quantity: number;
  created_at: Date;
}

export interface PaymentTable {
  id: string;
  order_id: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RefundTable {
  id: string;
  payment_id: string;
  amount: number;
  reason: string;
  status: string;
  created_at: Date;
}

export interface ShipmentTable {
  id: string;
  order_id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  shipped_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

export interface ReviewTable {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_verified_purchase: boolean;
  created_at: Date;
}

export interface CouponTable {
  id: string;
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
  created_at: Date;
}

export interface AuditLogTable {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}
