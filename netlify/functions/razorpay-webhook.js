const {
  HttpError,
  findPurchaseByRazorpayOrder,
  handleError,
  requireEnv,
  requireMethod,
  sendJson,
  sendPaymentReceipt,
  supabaseRest,
  verifyWebhookSignature,
} = require("../lib/server");

exports.handler = async (event) => {
  try {
    requireMethod(event, "POST");
    requireEnv(
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_WEBHOOK_SECRET",
    );
    if (!event.body) throw new HttpError(400, "Webhook request body is missing.");
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const signature = Object.entries(event.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "x-razorpay-signature",
    )?.[1];

    if (!signature || !verifyWebhookSignature(rawBody, signature)) {
      throw new HttpError(400, "Webhook signature is invalid.");
    }

    let webhook;
    try {
      webhook = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Webhook body is not valid JSON.");
    }
    if (webhook.event !== "payment.captured") {
      return sendJson(200, { received: true, ignored: true });
    }

    const payment = webhook.payload?.payment?.entity;
    if (
      !payment?.id ||
      !payment.order_id ||
      payment.status !== "captured"
    ) {
      throw new HttpError(400, "Captured payment details are incomplete.");
    }

    const found = await findPurchaseByRazorpayOrder(payment.order_id);
    const purchase = found?.record;
    if (!purchase) throw new HttpError(404, "Purchase for this payment was not found.");
    if (
      payment.amount !== purchase.amount_paise ||
      payment.currency !== purchase.currency
    ) {
      throw new HttpError(409, "Captured payment amount does not match the purchase.");
    }

    if (purchase.payment_status !== "paid") {
      const statusField = found.type === "booking" ? "booking_status" : "order_status";
      const purchaseStatus =
        found.type === "booking" ? "pending_confirmation" : "processing";
      await supabaseRest(found.table, "PATCH", {
        query: `id=eq.${encodeURIComponent(purchase.id)}`,
        body: {
          [statusField]: purchaseStatus,
          payment_status: "paid",
          razorpay_payment_id: payment.id,
          paid_at: new Date().toISOString(),
        },
      });
      purchase.payment_status = "paid";
      purchase[statusField] = purchaseStatus;
      purchase.razorpay_payment_id = payment.id;
    }

    const receiptEmailSent =
      purchase.receipt_email_status === "sent"
        ? true
        : await sendPaymentReceipt(purchase, found.type);
    if (!receiptEmailSent) {
      throw new HttpError(503, "Payment is recorded but receipt email delivery needs attention.");
    }

    return sendJson(200, { received: true });
  } catch (error) {
    return handleError(error);
  }
};
