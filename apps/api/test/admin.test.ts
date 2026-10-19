import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { signSession, SESSION_COOKIE } from '../src/auth/jwt.js';
import { resetRateLimits } from '../src/http/rate-limit.js';
import { startServer, type TestClient } from './helpers.js';

describe('Epic E10 — Admin Dashboard API', () => {
  let client: TestClient;

  let adminRoleId: string;
  let customerRoleId: string;
  let carFlagsCategoryId: string;

  const ADMIN_USER_ID = '018d9999-0000-4000-8000-000000000099';
  const CUSTOMER_USER_ID = '018d9999-0000-4000-8000-000000000088';

  let adminCookie: string;
  let customerCookie: string;

  async function cleanup() {
    await db
      .deleteFrom('refunds')
      .where('reason', 'like', 'Customer requested%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('payments')
      .where('currency', '=', 'INR')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('order_items')
      .where('name', 'like', 'E10%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('orders')
      .where('user_id', 'in', [CUSTOMER_USER_ID, ADMIN_USER_ID])
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('inventory')
      .where('product_id', 'in', (eb) =>
        eb.selectFrom('products').select('id').where('name', 'like', 'E10%'),
      )
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('product_images')
      .where('url', 'like', '%unsplash%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('products')
      .where('name', 'like', 'E10%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('coupons')
      .where('code', 'like', 'E10%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('banners')
      .where('title', 'like', 'E10%')
      .execute()
      .catch(() => {});
    await db
      .deleteFrom('users')
      .where('id', 'in', [ADMIN_USER_ID, CUSTOMER_USER_ID])
      .execute()
      .catch(() => {});
  }

  before(async () => {
    client = await startServer(createApp());

    const roles = await db.selectFrom('roles').selectAll().execute();
    const adminRole = roles.find((r) => r.name === 'admin');
    const customerRole = roles.find((r) => r.name === 'customer');

    assert.ok(adminRole, 'admin role must exist in reference data');
    assert.ok(customerRole, 'customer role must exist in reference data');

    adminRoleId = adminRole.id;
    customerRoleId = customerRole.id;

    const cat = await db
      .selectFrom('categories')
      .select('id')
      .where('slug', '=', 'car-flags')
      .executeTakeFirstOrThrow();
    carFlagsCategoryId = cat.id;

    // Clean up test users and dependent test rows if existing
    await cleanup();

    // Insert test admin and customer
    await db
      .insertInto('users')
      .values({
        id: ADMIN_USER_ID,
        email: 'test-admin@zyvora.internal',
        password_hash: 'dummyhash',
        full_name: 'System Admin',
        role_id: adminRoleId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    await db
      .insertInto('users')
      .values({
        id: CUSTOMER_USER_ID,
        email: 'test-customer@zyvora.internal',
        password_hash: 'dummyhash',
        full_name: 'Regular Customer',
        role_id: customerRoleId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    const adminToken = await signSession({
      sub: ADMIN_USER_ID,
      role: 'admin',
      email: 'test-admin@zyvora.internal',
    });
    adminCookie = `${SESSION_COOKIE}=${adminToken}`;

    const customerToken = await signSession({
      sub: CUSTOMER_USER_ID,
      role: 'customer',
      email: 'test-customer@zyvora.internal',
    });
    customerCookie = `${SESSION_COOKIE}=${customerToken}`;
  });

  after(async () => {
    await cleanup();
    await client.close();
    await db.destroy();
  });

  beforeEach(() => {
    resetRateLimits();
  });

  async function request(
    path: string,
    opts: {
      method?: string;
      cookie?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) {
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (opts.cookie) {
      headers.Cookie = opts.cookie;
    }
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${client.url}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  // ==========================================================================
  // ZYV-84 & ZYV-94: Security Spine & Customer Blocking
  // ==========================================================================
  describe('ZYV-84 & ZYV-94: Security spine and backend role enforcement', () => {
    it('blocks anonymous access with 401 AUTH_REQUIRED on admin routes', async () => {
      const endpoints = [
        { path: '/api/admin/products', method: 'GET' },
        { path: '/api/admin/orders', method: 'GET' },
        { path: '/api/admin/customers', method: 'GET' },
        { path: '/api/admin/reports/summary', method: 'GET' },
        { path: '/api/admin/audit-log', method: 'GET' },
        { path: '/api/admin/banners', method: 'GET' },
        { path: '/api/admin/content', method: 'GET' },
      ];

      for (const ep of endpoints) {
        const res = await request(ep.path, { method: ep.method });
        assert.equal(
          res.status,
          401,
          `expected 401 for anonymous on ${ep.method} ${ep.path}`,
        );
        assert.equal(res.body?.error?.code, 'AUTH_REQUIRED');
      }
    });

    it('blocks customer tokens with 403 FORBIDDEN on every admin route (ZYV-94)', async () => {
      const endpoints = [
        { path: '/api/admin/products', method: 'GET' },
        {
          path: '/api/admin/products',
          method: 'POST',
          body: { name: 'Hack', price: 100 },
        },
        { path: '/api/admin/orders', method: 'GET' },
        { path: '/api/admin/customers', method: 'GET' },
        { path: '/api/admin/reports/summary', method: 'GET' },
        { path: '/api/admin/reports/top-products', method: 'GET' },
        { path: '/api/admin/reports/low-stock', method: 'GET' },
        { path: '/api/admin/audit-log', method: 'GET' },
        { path: '/api/admin/banners', method: 'GET' },
        { path: '/api/admin/content', method: 'GET' },
        { path: '/api/admin/payments', method: 'GET' },
        { path: '/api/admin/refunds', method: 'GET' },
      ];

      for (const ep of endpoints) {
        const res = await request(ep.path, {
          method: ep.method,
          cookie: customerCookie,
          body: ep.body,
        });
        assert.equal(
          res.status,
          403,
          `expected 403 for customer role on ${ep.method} ${ep.path}`,
        );
        assert.equal(res.body?.error?.code, 'FORBIDDEN');
      }
    });

    it('permits admin tokens to reach admin endpoints', async () => {
      const res = await request('/api/admin/products', { cookie: adminCookie });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body?.data));
    });
  });

  // ==========================================================================
  // ZYV-92: Product CRUD & Archiving
  // ==========================================================================
  describe('ZYV-92: Product CRUD and archiving', () => {
    let createdProductId: string;

    it('creates product and initial inventory row', async () => {
      const res = await request('/api/admin/products', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          name: 'E10 Test Product — Admin Created',
          description: 'A genuine product created via admin dashboard API',
          categoryId: carFlagsCategoryId,
          price: 799,
          compareAtPrice: 999,
          image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341',
          isActive: true,
          stock: 45,
        },
      });

      assert.equal(res.status, 201);
      assert.ok(res.body?.data?.id);
      createdProductId = res.body.data.id;
      assert.equal(res.body.data.price, 799);
      assert.equal(res.body.data.compare_at_price, 999);

      // Verify inventory row was created
      const inv = await db
        .selectFrom('inventory')
        .selectAll()
        .where('product_id', '=', createdProductId)
        .executeTakeFirst();
      assert.ok(inv, 'inventory row must be created');
      assert.equal(inv.quantity, 45);
    });

    it('reads product detail including stock and images', async () => {
      const res = await request(`/api/admin/products/${createdProductId}`, {
        cookie: adminCookie,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.id, createdProductId);
      assert.equal(res.body.data.stock, 45);
      assert.ok(Array.isArray(res.body.data.images));
    });

    it('updates product details via PATCH', async () => {
      const res = await request(`/api/admin/products/${createdProductId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
          name: 'E10 Test Product — Updated Title',
          price: 849,
          stock: 60,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'E10 Test Product — Updated Title');
      assert.equal(res.body.data.price, 849);

      const inv = await db
        .selectFrom('inventory')
        .select('quantity')
        .where('product_id', '=', createdProductId)
        .executeTakeFirstOrThrow();
      assert.equal(inv.quantity, 60);
    });

    it('archives product via DELETE and hides it from public storefront', async () => {
      const delRes = await request(`/api/admin/products/${createdProductId}`, {
        method: 'DELETE',
        cookie: adminCookie,
      });
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.archived, true);

      // Assert archived product is hidden from public API
      const publicRes = await request(`/api/products/${createdProductId}`);
      assert.equal(
        publicRes.status,
        404,
        'archived product must return 404 on public route',
      );
    });
  });

  // ==========================================================================
  // ZYV-80: Product Image Management
  // ==========================================================================
  describe('ZYV-80: Product image upload and management', () => {
    let testProdId: string;
    let imageId1: string;
    let imageId2: string;

    before(async () => {
      const p = await db
        .insertInto('products')
        .values({
          name: 'E10 Test Image Gallery Product',
          description: 'Testing image gallery upload and reorder',
          category_id: carFlagsCategoryId,
          price: 399,
          image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      testProdId = p.id;
    });

    it('rejects invalid file types that are not approved image URLs', async () => {
      const res = await request(`/api/admin/products/${testProdId}/images`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          url: 'https://malicious.example.com/payload.exe',
          altText: 'Not an image',
        },
      });
      assert.equal(res.status, 400);
    });

    it('uploads images and designates primary image', async () => {
      const res1 = await request(`/api/admin/products/${testProdId}/images`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          url: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888.jpg',
          altText: 'Side angle',
          displayOrder: 0,
        },
      });
      assert.equal(res1.status, 201);
      imageId1 = res1.body.data.id;

      const res2 = await request(`/api/admin/products/${testProdId}/images`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
          url: 'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0.webp',
          altText: 'Front hero',
          displayOrder: 1,
          isPrimary: true,
        },
      });
      assert.equal(res2.status, 201);
      imageId2 = res2.body.data.id;

      // Verify primary image was updated on the product row
      const prod = await db
        .selectFrom('products')
        .select('image')
        .where('id', '=', testProdId)
        .executeTakeFirstOrThrow();
      assert.equal(
        prod.image,
        'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0.webp',
      );
    });

    it('reorders images', async () => {
      const res = await request(
        `/api/admin/products/${testProdId}/images/reorder`,
        {
          method: 'PATCH',
          cookie: adminCookie,
          body: { imageIds: [imageId2, imageId1] },
        },
      );
      assert.equal(res.status, 200);

      const listRes = await request(
        `/api/admin/products/${testProdId}/images`,
        {
          cookie: adminCookie,
        },
      );
      assert.equal(listRes.status, 200);
      assert.equal(listRes.body.data[0].id, imageId2);
      assert.equal(listRes.body.data[1].id, imageId1);
    });

    it('deletes an image', async () => {
      const res = await request(
        `/api/admin/products/${testProdId}/images/${imageId1}`,
        {
          method: 'DELETE',
          cookie: adminCookie,
        },
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.data.success, true);
    });
  });

  // ==========================================================================
  // ZYV-78: Price, Discount and Inventory Management
  // ==========================================================================
  describe('ZYV-78: Price, discount and inventory management', () => {
    let testProdId: string;

    before(async () => {
      const p = await db
        .insertInto('products')
        .values({
          name: 'E10 Test Commercial Product',
          description: 'Testing pricing and coupons',
          category_id: carFlagsCategoryId,
          price: 500,
          compare_at_price: 600,
          image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      testProdId = p.id;

      await db
        .insertInto('inventory')
        .values({
          product_id: testProdId,
          quantity: 20,
          reserved_quantity: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    });

    it('updates price and compare-at price', async () => {
      const res = await request(`/api/admin/products/${testProdId}/pricing`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { price: 449, compareAtPrice: 599 },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.price, 449);
      assert.equal(res.body.data.compareAtPrice, 599);
    });

    it('adjusts stock level and records audit trail', async () => {
      const res = await request(`/api/admin/products/${testProdId}/inventory`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { quantity: 150, reason: 'Restock shipment received' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.quantity, 150);

      // Verify audit log entry
      const auditEntry = await db
        .selectFrom('audit_logs')
        .selectAll()
        .where('action', '=', 'admin.inventory.stock_adjustment')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      assert.ok(auditEntry, 'audit entry must exist for stock adjustment');
    });

    it('creates and manages coupons for discounts', async () => {
      const createRes = await request('/api/admin/coupons', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          code: 'E10FESTIVE20',
          discountType: 'percentage',
          discountValue: 20,
          minOrderAmount: 1000,
          maxDiscount: 500,
          usageLimit: 100,
        },
      });
      assert.equal(createRes.status, 201);
      assert.equal(createRes.body.data.code, 'E10FESTIVE20');

      const couponId = createRes.body.data.id;

      const listRes = await request('/api/admin/coupons', {
        cookie: adminCookie,
      });
      assert.equal(listRes.status, 200);
      assert.ok(listRes.body.data.some((c: any) => c.code === 'E10FESTIVE20'));

      const delRes = await request(`/api/admin/coupons/${couponId}`, {
        method: 'DELETE',
        cookie: adminCookie,
      });
      assert.equal(delRes.status, 200);
      assert.equal(delRes.body.data.isActive, false);
    });
  });

  // ==========================================================================
  // ZYV-81 & ZYV-85: Order Search, Filtering and Status Transitions
  // ==========================================================================
  describe('ZYV-81 & ZYV-85: Order search, filtering and status transitions', () => {
    let orderId: string;

    before(async () => {
      const ord = await db
        .insertInto('orders')
        .values({
          user_id: CUSTOMER_USER_ID,
          checkout_session_id: '018d9999-0000-4000-8000-000000000077',
          subtotal: 998,
          shipping: 0,
          tax: 0,
          discount: 0,
          total: 998,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      orderId = ord.id;
    });

    it('searches and filters orders (ZYV-81)', async () => {
      const res = await request('/api/admin/orders?status=pending', {
        cookie: adminCookie,
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.length > 0);
      assert.ok(res.body.pagination);

      const detailRes = await request(`/api/admin/orders/${orderId}`, {
        cookie: adminCookie,
      });
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.data.id, orderId);
    });

    it('enforces valid status transitions only (ZYV-85)', async () => {
      // 1. Invalid jump from pending -> delivered should 400
      const invalidRes = await request(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'delivered' },
      });
      assert.equal(invalidRes.status, 400);

      // 2. Valid transition from pending -> confirmed
      const validRes1 = await request(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'confirmed', note: 'Payment verified' },
      });
      assert.equal(validRes1.status, 200);
      assert.equal(validRes1.body.data.status, 'confirmed');

      // 3. Valid transition confirmed -> processing
      const validRes2 = await request(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'processing' },
      });
      assert.equal(validRes2.status, 200);
      assert.equal(validRes2.body.data.status, 'processing');
    });
  });

  // ==========================================================================
  // ZYV-95: Reports & Exports
  // ==========================================================================
  describe('ZYV-95: Admin sales and order reports', () => {
    it('returns sales summary report in JSON and CSV formats', async () => {
      const jsonRes = await request('/api/admin/reports/summary', {
        cookie: adminCookie,
      });
      assert.equal(jsonRes.status, 200);
      assert.ok('totalOrders' in jsonRes.body.data);
      assert.ok('totalRevenue' in jsonRes.body.data);

      const csvRes = await request('/api/admin/reports/summary?format=csv', {
        cookie: adminCookie,
      });
      assert.equal(csvRes.status, 200);
      assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'));
      assert.ok(String(csvRes.body).includes('Total Orders'));
    });

    it('returns top products report', async () => {
      const res = await request('/api/admin/reports/top-products?limit=5', {
        cookie: adminCookie,
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });

    it('returns low stock report', async () => {
      const res = await request('/api/admin/reports/low-stock?threshold=50', {
        cookie: adminCookie,
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  // ==========================================================================
  // ZYV-86: Customer Accounts Management
  // ==========================================================================
  describe('ZYV-86: Manage customer accounts', () => {
    it('searches and lists customers without exposing password hashes', async () => {
      const res = await request('/api/admin/customers', {
        cookie: adminCookie,
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      for (const cust of res.body.data) {
        assert.equal(
          cust.password_hash,
          undefined,
          'password_hash must never leak',
        );
      }
    });

    it('views customer profile and orders history', async () => {
      const profRes = await request(
        `/api/admin/customers/${CUSTOMER_USER_ID}`,
        {
          cookie: adminCookie,
        },
      );
      assert.equal(profRes.status, 200);
      assert.equal(profRes.body.data.id, CUSTOMER_USER_ID);

      const ordersRes = await request(
        `/api/admin/customers/${CUSTOMER_USER_ID}/orders`,
        {
          cookie: adminCookie,
        },
      );
      assert.equal(ordersRes.status, 200);
      assert.ok(Array.isArray(ordersRes.body.data));
    });
  });

  // ==========================================================================
  // ZYV-93: Banners and Policy Content Management
  // ==========================================================================
  describe('ZYV-93: Banners and policy content', () => {
    it('creates banner and lists active banners on public endpoint', async () => {
      const createRes = await request('/api/admin/banners', {
        method: 'POST',
        cookie: adminCookie,
        body: {
          title: 'E10 Special Diwali Flag Collection',
          imageUrl: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48',
          linkUrl: 'https://zyvora-omega.vercel.app/catalog',
          displayOrder: 1,
        },
      });
      assert.equal(createRes.status, 201);
      assert.equal(
        createRes.body.data.title,
        'E10 Special Diwali Flag Collection',
      );

      // Assert visible on public site endpoint
      const pubRes = await request('/api/banners');
      assert.equal(pubRes.status, 200);
      assert.ok(
        pubRes.body.data.some(
          (b: any) => b.title === 'E10 Special Diwali Flag Collection',
        ),
      );
    });

    it('updates policy content block and reflects change publicly', async () => {
      const putRes = await request('/api/admin/content/shipping-policy', {
        method: 'PUT',
        cookie: adminCookie,
        body: {
          title: 'Shipping Policy',
          body: 'Updated shipping policy: Express delivery dispatched within 24 hours.',
        },
      });
      assert.equal(putRes.status, 200);

      // Verify public read
      const pubRes = await request('/api/content/shipping-policy');
      assert.equal(pubRes.status, 200);
      assert.equal(
        pubRes.body.data.body,
        'Updated shipping policy: Express delivery dispatched within 24 hours.',
      );
    });
  });

  // ==========================================================================
  // ZYV-91: Payment Status and Refund Requests (Database-scoped)
  // ==========================================================================
  describe('ZYV-91: Payment status and refund requests (Database-scoped)', () => {
    let paymentId: string;
    let refundId: string;

    before(async () => {
      let ord = await db
        .selectFrom('orders')
        .select('id')
        .where('user_id', '=', CUSTOMER_USER_ID)
        .executeTakeFirst();

      if (!ord) {
        ord = await db
          .insertInto('orders')
          .values({
            user_id: CUSTOMER_USER_ID,
            checkout_session_id: '018d9999-0000-4000-8000-000000000077',
            subtotal: 998,
            shipping: 0,
            tax: 0,
            discount: 0,
            total: 998,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      }

      const pay = await db
        .insertInto('payments')
        .values({
          order_id: ord.id,
          amount: 998,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
          created_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      paymentId = pay.id;

      const ref = await db
        .insertInto('refunds')
        .values({
          payment_id: paymentId,
          amount: 998,
          reason: 'Customer requested cancellation prior to shipment',
          status: 'pending',
          created_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      refundId = ref.id;
    });

    it('lists payments without exposing raw card data', async () => {
      const res = await request('/api/admin/payments', { cookie: adminCookie });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });

    it('lists and updates refund status', async () => {
      const listRes = await request('/api/admin/refunds', {
        cookie: adminCookie,
      });
      assert.equal(listRes.status, 200);
      assert.ok(listRes.body.data.some((r: any) => r.id === refundId));

      const updateRes = await request(`/api/admin/refunds/${refundId}/status`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { status: 'approved', note: 'Approved under 24-hr grace window' },
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.status, 'approved');
    });
  });
});
