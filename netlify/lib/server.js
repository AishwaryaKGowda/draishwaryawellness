const crypto = require("node:crypto");

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function requireMethod(event, method) {
  if (event.httpMethod !== method) {
    throw new HttpError(405, "Method not allowed.");
  }
}

function requireEnv(...names) {
  for (const name of names) {
    if (!process.env[name]) {
      throw new HttpError(503, `Server configuration is missing ${name}.`);
    }
  }
}

function parseJsonBody(event) {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function getHeader(event, name) {
  const match = Object.entries(event.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return match?.[1] ?? "";
}

async function getAuthenticatedUser(event) {
  const authorization = getHeader(event, "authorization");
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Please log in to continue.");

  requireEnv("SUPABASE_URL", "SUPABASE_ANON_KEY");
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new HttpError(401, "Your session has expired. Please log in again.");

  const user = await response.json();
  if (
    !user.id ||
    !user.email ||
    (!user.email_confirmed_at && !user.confirmed_at)
  ) {
    throw new HttpError(403, "Verify your email address before continuing.");
  }
  return user;
}

async function supabaseRest(table, method, options = {}) {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const query = options.query ? `?${options.query}` : "";
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer ?? "return=minimal",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let result = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new HttpError(502, "The database returned an invalid response.");
    }
  }

  if (!response.ok) {
    console.error("Supabase request failed", {
      table,
      method,
      status: response.status,
      code: result?.code,
    });
    throw new HttpError(
      502,
      response.status === 404
        ? "The booking database is not configured yet."
        : "Could not save the request to the booking database.",
    );
  }
  return result;
}

async function findPurchaseByRazorpayOrder(razorpayOrderId, userId) {
  const tables = [
    { name: "bookings", type: "booking" },
    { name: "orders", type: "order" },
  ];

  for (const table of tables) {
    const ownerFilter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";
    const rows = await supabaseRest(table.name, "GET", {
      query: `select=*&razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}${ownerFilter}&limit=1`,
    });
    if (rows?.[0]) return { record: rows[0], table: table.name, type: table.type };
  }
  return null;
}

function razorpayAuthorization() {
  requireEnv("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET");
  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  return `Basic ${credentials}`;
}

async function razorpayRequest(path, method = "GET", body) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: razorpayAuthorization(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Razorpay request failed", {
      path,
      method,
      status: response.status,
      code: result?.error?.code,
    });
    throw new HttpError(502, "The payment provider could not complete this request.");
  }
  return result;
}

function constantTimeHexEqual(actual, expected) {
  if (!/^[a-f0-9]+$/i.test(actual) || !/^[a-f0-9]+$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return constantTimeHexEqual(signature, expected);
}

function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return constantTimeHexEqual(signature, expected);
}

function todayInIndia() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function sendPaymentReceipt(purchase, purchaseType) {
  const table = purchaseType === "booking" ? "bookings" : "orders";
  if (!process.env.RESEND_API_KEY || !process.env.RECEIPT_FROM_EMAIL) {
    await supabaseRest(table, "PATCH", {
      query: `id=eq.${encodeURIComponent(purchase.id)}`,
      body: { receipt_email_status: "failed" },
    });
    return false;
  }

  const name = escapeHtml(purchase.full_name);
  const amount = (purchase.amount_paise / 100).toFixed(2);
  let orderSummary;
  let htmlSummary;
  if (purchaseType === "booking") {
    orderSummary = [
      `Service: ${purchase.service}`,
      `Preferred date: ${purchase.preferred_date}`,
      `Preferred time: ${purchase.preferred_time} (IST)`,
    ];
    htmlSummary = `<tr><td>Service</td><td>${escapeHtml(purchase.service)}</td></tr><tr><td>Preferred date</td><td>${escapeHtml(purchase.preferred_date)}</td></tr><tr><td>Preferred time</td><td>${escapeHtml(purchase.preferred_time)} (IST)</td></tr>`;
  } else {
    const items = await supabaseRest("order_items", "GET", {
      query: `select=item_name,pack_size,quantity,unit_price_paise&order_id=eq.${encodeURIComponent(purchase.id)}&order=id.asc`,
    });
    if (!items?.length) {
      throw new HttpError(502, "Could not load the product receipt items.");
    }
    orderSummary = items.map(
      (item) =>
        `${item.item_name} (${item.pack_size}) × ${item.quantity}: INR ${(item.unit_price_paise * item.quantity / 100).toFixed(2)}`,
    );
    htmlSummary = items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.item_name)} (${escapeHtml(item.pack_size)}) × ${item.quantity}</td><td>INR ${(item.unit_price_paise * item.quantity / 100).toFixed(2)}</td></tr>`,
      )
      .join("");
    orderSummary.push("Delivery fee: INR 50.00");
    htmlSummary += "<tr><td>Delivery fee</td><td>INR 50.00</td></tr>";
    orderSummary.push(
      `Deliver to: ${purchase.shipping_address}, ${purchase.shipping_city}, ${purchase.shipping_state} ${purchase.shipping_pincode}, India`,
    );
    htmlSummary += `<tr><td>Deliver to</td><td>${escapeHtml(purchase.shipping_address)}, ${escapeHtml(purchase.shipping_city)}, ${escapeHtml(purchase.shipping_state)} ${escapeHtml(purchase.shipping_pincode)}, India</td></tr>`;
  }

  const appointmentUrl = `https://${process.env.URL || "draishwaryak.netlify.app"}/#booking`;
  const payload = {
    from: process.env.RECEIPT_FROM_EMAIL,
    to: [purchase.email],
    subject:
      purchaseType === "booking"
        ? "Your Dr Aishwarya Wellness appointment payment receipt"
        : "Your Dr Aishwarya Wellness order payment receipt",
    text: [
      `Hello ${purchase.full_name},`,
      "",
      "We received your payment.",
      ...orderSummary,
      `Amount paid: INR ${amount}`,
      `Payment reference: ${purchase.razorpay_payment_id}`,
      "",
      purchaseType === "booking"
        ? "Your appointment request is pending availability confirmation. We will contact you to confirm the appointment."
        : "Your product order is being prepared for delivery.",
      "",
      "Dr Aishwarya Wellness",
    ].join("\n"),
    html: `<p>Hello ${name},</p><p>We received your payment.</p><table>${htmlSummary}<tr><td>Amount paid</td><td>INR ${amount}</td></tr><tr><td>Payment reference</td><td>${escapeHtml(purchase.razorpay_payment_id)}</td></tr></table><p>${purchaseType === "booking" ? "Your appointment request is pending availability confirmation. We will contact you to confirm the appointment." : "Your product order is being prepared for delivery."}</p><p><a href="${appointmentUrl}">Contact Dr Aishwarya Wellness</a></p>`,
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${purchaseType}-receipt-${purchase.id}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    console.error("Receipt email delivery failed", {
      purchaseId: purchase.id,
      status: response.status,
      code: result?.name,
    });
    await supabaseRest(table, "PATCH", {
      query: `id=eq.${encodeURIComponent(purchase.id)}`,
      body: { receipt_email_status: "failed" },
    });
    return false;
  }

  await supabaseRest(table, "PATCH", {
    query: `id=eq.${encodeURIComponent(purchase.id)}`,
    body: {
      receipt_email_status: "sent",
      receipt_email_sent_at: new Date().toISOString(),
    },
  });
  return true;
}

function handleError(error) {
  if (error instanceof HttpError) return sendJson(error.statusCode, { error: error.message });
  console.error("Unexpected server error", error);
  return sendJson(500, { error: "An unexpected server error occurred. Please try again." });
}

module.exports = {
  HttpError,
  getAuthenticatedUser,
  findPurchaseByRazorpayOrder,
  handleError,
  parseJsonBody,
  razorpayRequest,
  requireEnv,
  requireMethod,
  sendJson,
  sendPaymentReceipt,
  supabaseRest,
  todayInIndia,
  verifyCheckoutSignature,
  verifyWebhookSignature,
};
