const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const createOrder = require("../netlify/functions/create-order");
const razorpayWebhook = require("../netlify/functions/razorpay-webhook");
const verifyPayment = require("../netlify/functions/verify-payment");

const testEnvironment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_public",
  RAZORPAY_KEY_SECRET: "test-razorpay-secret",
};

function response(data, status = 200) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withEnvironment(overrides, action) {
  const previousEnvironment = { ...process.env };
  const originalFetch = global.fetch;
  for (const name of Object.keys(testEnvironment)) delete process.env[name];
  Object.assign(process.env, testEnvironment, overrides);

  try {
    await action();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnvironment)) delete process.env[name];
    }
    Object.assign(process.env, previousEnvironment);
    global.fetch = originalFetch;
  }
}

function authenticatedEvent(body) {
  return {
    httpMethod: "POST",
    headers: { authorization: "Bearer test-session-token" },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

test("appointment checkout uses the server-set fee, not a client-supplied amount", async () => {
  await withEnvironment({}, async () => {
    const savedOrders = [];
    let razorpayOrderRequest;
    global.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/auth/v1/user")) {
        return response({
          id: "user-1",
          email: "customer@example.com",
          email_confirmed_at: "2099-01-01T00:00:00Z",
        });
      }
      if (url.pathname === "/rest/v1/profiles") return response(null, 201);
      if (url.pathname === "/rest/v1/bookings" && options.method === "POST") {
        const order = JSON.parse(options.body);
        savedOrders.push(order);
        return response([{ id: "booking-record-1", ...order }], 201);
      }
      if (url.pathname === "/rest/v1/bookings" && options.method === "PATCH") {
        return response(null, 204);
      }
      if (url.pathname === "/v1/orders" && url.hostname === "api.razorpay.com") {
        razorpayOrderRequest = JSON.parse(options.body);
        return response({ id: "order_razorpay_1", ...razorpayOrderRequest });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    };

    const result = await createOrder.handler(
      authenticatedEvent({
        type: "appointment",
        service: "Wellness consultation",
        appointmentDate: "2099-12-31",
        preferredTime: "10:30",
        fullName: "Test Customer",
        phone: "+91 98765 43210",
        amount: 1,
      }),
    );

    assert.equal(result.statusCode, 200);
    assert.equal(savedOrders[0].amount_paise, 50000);
    assert.equal(razorpayOrderRequest.amount, 50000);
    assert.equal(razorpayOrderRequest.currency, "INR");
    assert.equal(razorpayOrderRequest.receipt.length <= 40, true);
    assert.equal(JSON.parse(result.body).razorpayOrderId, "order_razorpay_1");
    assert.equal(JSON.parse(result.body).purchaseType, "booking");
  });
});

test("product checkout uses database prices plus the fixed India delivery fee", async () => {
  await withEnvironment({}, async () => {
    let orderRecord;
    let savedItems;
    let razorpayOrderRequest;
    global.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/auth/v1/user")) {
        return response({
          id: "user-1",
          email: "customer@example.com",
          email_confirmed_at: "2099-01-01T00:00:00Z",
        });
      }
      if (url.pathname === "/rest/v1/products") {
        return response([
          {
            id: "ashwagandha-60-capsules",
            name: "Ashwagandha",
            pack_size: "60 capsules",
            price_paise: 35000,
            is_active: true,
          },
        ]);
      }
      if (url.pathname === "/rest/v1/profiles") return response(null, 201);
      if (url.pathname === "/rest/v1/orders" && options.method === "POST") {
        orderRecord = JSON.parse(options.body);
        return response([{ id: "order-record-2", ...orderRecord }], 201);
      }
      if (url.pathname === "/rest/v1/order_items" && options.method === "POST") {
        savedItems = JSON.parse(options.body);
        return response(null, 201);
      }
      if (url.pathname === "/rest/v1/orders" && options.method === "PATCH") {
        return response(null, 204);
      }
      if (url.pathname === "/v1/orders" && url.hostname === "api.razorpay.com") {
        razorpayOrderRequest = JSON.parse(options.body);
        return response({ id: "order_razorpay_2", ...razorpayOrderRequest });
      }
      throw new Error(`Unexpected request: ${url.href}`);
    };

    const result = await createOrder.handler(
      authenticatedEvent({
        type: "product",
        fullName: "Test Customer",
        phone: "+91 98765 43210",
        items: [{ productId: "ashwagandha-60-capsules", quantity: 2, price: 1 }],
        address: "12 Green Street",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      }),
    );

    assert.equal(result.statusCode, 200);
    assert.equal(orderRecord.amount_paise, 75000);
    assert.equal(razorpayOrderRequest.amount, 75000);
    assert.equal(savedItems[0].unit_price_paise, 35000);
    assert.equal(savedItems[0].quantity, 2);
    assert.equal(savedItems[0].order_id, "order-record-2");
  });
});

test("payment callback records only a captured payment matching the saved order", async () => {
  await withEnvironment({}, async () => {
    const orderId = "order_razorpay_3";
    const paymentId = "pay_3";
    const initialOrder = {
      id: "order-record-3",
      user_id: "user-1",
      payment_status: "pending",
      receipt_email_status: "pending",
      amount_paise: 50000,
      currency: "INR",
      booking_status: "pending_payment",
      razorpay_payment_id: paymentId,
    };
    const updates = [];
    global.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/auth/v1/user")) {
        return response({
          id: "user-1",
          email: "customer@example.com",
          email_confirmed_at: "2099-01-01T00:00:00Z",
        });
      }
      if (url.pathname === "/rest/v1/bookings" && options.method === "GET") {
        return response([initialOrder]);
      }
      if (url.pathname === "/v1/payments/pay_3" && url.hostname === "api.razorpay.com") {
        return response({
          id: paymentId,
          order_id: orderId,
          amount: 50000,
          currency: "INR",
          status: "captured",
        });
      }
      if (url.pathname === "/rest/v1/bookings" && options.method === "PATCH") {
        updates.push(JSON.parse(options.body));
        return response(null, 204);
      }
      throw new Error(`Unexpected request: ${url.href}`);
    };

    const result = await verifyPayment.handler(
      authenticatedEvent({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: hmac(`${orderId}|${paymentId}`, process.env.RAZORPAY_KEY_SECRET),
      }),
    );

    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).paymentStatus, "paid");
    assert.equal(JSON.parse(result.body).receiptEmailSent, false);
    assert.equal(updates[0].payment_status, "paid");
    assert.equal(updates[0].booking_status, "pending_confirmation");
    assert.equal(updates.at(-1).receipt_email_status, "failed");
  });
});

test("captured-payment webhook updates a product order and sends its receipt", async () => {
  await withEnvironment(
    {
      RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
      RESEND_API_KEY: "test-resend-key",
      RECEIPT_FROM_EMAIL: "receipts@example.com",
    },
    async () => {
      const orderId = "order_razorpay_webhook";
      const paymentId = "pay_webhook";
      const savedOrder = {
        id: "order-record-webhook",
        user_id: "user-1",
        email: "customer@example.com",
        full_name: "Test Customer",
        shipping_address: "12 Green Street",
        shipping_city: "Bengaluru",
        shipping_state: "Karnataka",
        shipping_pincode: "560001",
        amount_paise: 75000,
        currency: "INR",
        order_status: "pending_payment",
        payment_status: "pending",
        receipt_email_status: "pending",
        razorpay_order_id: orderId,
      };
      const updates = [];
      const payload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 75000,
              currency: "INR",
              status: "captured",
            },
          },
        },
      });
      global.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.hostname === "api.resend.com") return response({ id: "email-1" });
        if (url.pathname === "/rest/v1/bookings" && options.method === "GET") {
          return response([]);
        }
        if (url.pathname === "/rest/v1/orders" && options.method === "GET") {
          return response([savedOrder]);
        }
        if (url.pathname === "/rest/v1/orders" && options.method === "PATCH") {
          updates.push(JSON.parse(options.body));
          return response(null, 204);
        }
        if (url.pathname === "/rest/v1/order_items" && options.method === "GET") {
          return response([
            {
              item_name: "Ashwagandha",
              pack_size: "60 capsules",
              quantity: 2,
              unit_price_paise: 35000,
            },
          ]);
        }
        throw new Error(`Unexpected request: ${url.href}`);
      };

      const result = await razorpayWebhook.handler({
        httpMethod: "POST",
        headers: {
          "x-razorpay-signature": hmac(payload, process.env.RAZORPAY_WEBHOOK_SECRET),
        },
        body: payload,
        isBase64Encoded: false,
      });

      assert.equal(result.statusCode, 200);
      assert.deepEqual(JSON.parse(result.body), { received: true });
      assert.equal(updates[0].payment_status, "paid");
      assert.equal(updates[0].order_status, "processing");
      assert.equal(updates.at(-1).receipt_email_status, "sent");
    },
  );
});
