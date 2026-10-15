const {
  HttpError,
  getAuthenticatedUser,
  handleError,
  parseJsonBody,
  razorpayRequest,
  requireEnv,
  requireMethod,
  sendJson,
  supabaseRest,
  todayInIndia,
} = require("../lib/server");

const appointmentTypes = new Set([
  "Wellness consultation",
  "Personal wellness plan",
  "Ongoing care",
  "Not sure yet",
]);
const appointmentPricePaise = 50000;
const productDeliveryPaise = 5000;

function validateCustomer(fullName, phone) {
  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpError(400, "Enter a valid name.");
  }
  if (!/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
    throw new HttpError(400, "Enter a valid phone number.");
  }
}

function validateAppointment(body) {
  const service = typeof body.service === "string" ? body.service.trim() : "";
  const preferredDate =
    typeof body.appointmentDate === "string" ? body.appointmentDate : "";
  const preferredTime =
    typeof body.preferredTime === "string" ? body.preferredTime : "";

  if (!appointmentTypes.has(service)) {
    throw new HttpError(400, "Choose a valid appointment type.");
  }
  const parsedDate = new Date(`${preferredDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== preferredDate ||
    preferredDate < todayInIndia()
  ) {
    throw new HttpError(400, "Choose a valid appointment date that is not in the past.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
    throw new HttpError(400, "Choose a valid preferred appointment time.");
  }

  return {
    service,
    preferred_date: preferredDate,
    preferred_time: preferredTime,
    amount_paise: appointmentPricePaise,
  };
}

async function prepareProductOrder(body) {
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const pincode = typeof body.pincode === "string" ? body.pincode.trim() : "";
  if (
    address.length < 4 ||
    address.length > 250 ||
    city.length < 2 ||
    city.length > 80 ||
    state.length < 2 ||
    state.length > 80 ||
    !/^\d{6}$/.test(pincode)
  ) {
    throw new HttpError(400, "Enter a valid Indian delivery address and six-digit PIN code.");
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > 10
  ) {
    throw new HttpError(400, "Add one or more products to your basket.");
  }

  const quantities = new Map();
  for (const item of body.items) {
    if (
      !item ||
      typeof item.productId !== "string" ||
      !/^[a-z0-9-]{1,80}$/.test(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10
    ) {
      throw new HttpError(400, "One or more basket items are invalid.");
    }
    if (quantities.has(item.productId)) {
      throw new HttpError(400, "Each product should appear only once in the basket.");
    }
    quantities.set(item.productId, item.quantity);
  }

  const ids = [...quantities.keys()];
  const productRows = await supabaseRest("products", "GET", {
    query: `select=id,name,pack_size,price_paise,is_active&id=in.(${ids.map(encodeURIComponent).join(",")})`,
  });
  if (!Array.isArray(productRows) || productRows.length !== ids.length) {
    throw new HttpError(400, "A product in your basket is no longer available.");
  }

  const items = productRows.map((product) => {
    if (!product.is_active || !Number.isInteger(product.price_paise) || product.price_paise <= 0) {
      throw new HttpError(400, "A product in your basket is no longer available.");
    }
    return {
      product_id: product.id,
      item_name: product.name,
      pack_size: product.pack_size,
      unit_price_paise: product.price_paise,
      quantity: quantities.get(product.id),
    };
  });
  const subtotal = items.reduce(
    (total, item) => total + item.unit_price_paise * item.quantity,
    0,
  );

  return {
    order: {
      shipping_address: address,
      shipping_city: city,
      shipping_state: state,
      shipping_pincode: pincode,
      shipping_country: "India",
      amount_paise: subtotal + productDeliveryPaise,
    },
    items,
  };
}

exports.handler = async (event) => {
  let purchaseId;
  let purchaseTable;
  let statusField;
  let purchaseType;
  try {
    requireMethod(event, "POST");
    requireEnv(
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
    );

    const user = await getAuthenticatedUser(event);
    const body = parseJsonBody(event);
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    validateCustomer(fullName, phone);

    let orderDetails;
    let items = [];
    if (body.type === "appointment") {
      orderDetails = validateAppointment(body);
      purchaseTable = "bookings";
      statusField = "booking_status";
      purchaseType = "booking";
    } else if (body.type === "product") {
      const prepared = await prepareProductOrder(body);
      orderDetails = prepared.order;
      items = prepared.items;
      purchaseTable = "orders";
      statusField = "order_status";
      purchaseType = "order";
    } else {
      throw new HttpError(400, "Choose an appointment or product order.");
    }

    await supabaseRest("profiles", "POST", {
      query: "on_conflict=id",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        id: user.id,
        full_name: fullName,
        phone,
        updated_at: new Date().toISOString(),
      },
    });

    const rows = await supabaseRest(purchaseTable, "POST", {
      prefer: "return=representation",
      body: {
        ...orderDetails,
        user_id: user.id,
        email: user.email,
        full_name: fullName,
        phone,
        currency: "INR",
        [statusField]: "pending_payment",
        payment_status: "pending",
        receipt_email_status: "pending",
      },
    });
    const purchase = rows?.[0];
    if (!purchase?.id) throw new HttpError(502, "Could not create your purchase.");
    purchaseId = purchase.id;

    try {
      if (items.length) {
        await supabaseRest("order_items", "POST", {
          body: items.map((item) => ({ ...item, order_id: purchaseId })),
        });
      }

      const razorpayOrder = await razorpayRequest("/orders", "POST", {
        amount: purchase.amount_paise,
        currency: "INR",
        receipt: `w-${purchaseId.replaceAll("-", "")}`,
        notes: {
          purchase_id: purchaseId,
          user_id: user.id,
          purchase_type: purchaseType,
        },
      });

      await supabaseRest(purchaseTable, "PATCH", {
        query: `id=eq.${encodeURIComponent(purchaseId)}`,
        body: { razorpay_order_id: razorpayOrder.id },
      });

      return sendJson(200, {
        purchaseId: purchase.id,
        purchaseType,
        razorpayOrderId: razorpayOrder.id,
        keyId: process.env.RAZORPAY_KEY_ID,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      });
    } catch (error) {
      await supabaseRest(purchaseTable, "PATCH", {
        query: `id=eq.${encodeURIComponent(purchaseId)}`,
        body: {
          [statusField]: "payment_failed",
          payment_status: "failed",
        },
      });
      throw error;
    }
  } catch (error) {
    if (purchaseId && error instanceof HttpError && error.statusCode >= 500) {
      console.error("Purchase payment setup did not complete", { purchaseId });
    }
    return handleError(error);
  }
};
