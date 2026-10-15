const {
  HttpError,
  findPurchaseByRazorpayOrder,
  getAuthenticatedUser,
  handleError,
  parseJsonBody,
  razorpayRequest,
  requireEnv,
  requireMethod,
  sendJson,
  sendPaymentReceipt,
  supabaseRest,
  verifyCheckoutSignature,
} = require("../lib/server");

exports.handler = async (event) => {
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
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId =
      typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature =
      typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!orderId || !paymentId || !signature) {
      throw new HttpError(400, "The payment response is incomplete.");
    }
    if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
      throw new HttpError(400, "The payment signature could not be verified.");
    }

    const found = await findPurchaseByRazorpayOrder(orderId, user.id);
    const purchase = found?.record;
    if (!purchase) throw new HttpError(404, "The purchase for this payment was not found.");

    if (purchase.payment_status !== "paid") {
      const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
      if (
        payment.order_id !== orderId ||
        payment.amount !== purchase.amount_paise ||
        payment.currency !== purchase.currency ||
        !["authorized", "captured"].includes(payment.status)
      ) {
        throw new HttpError(409, "The payment does not match this purchase.");
      }

      let capturedPayment = payment;
      if (payment.status === "authorized") {
        capturedPayment = await razorpayRequest(
          `/payments/${encodeURIComponent(paymentId)}/capture`,
          "POST",
          { amount: payment.amount, currency: payment.currency },
        );
      }
      if (capturedPayment.status !== "captured") {
        throw new HttpError(409, "The payment is not captured yet. Please retry shortly.");
      }

      const statusField = found.type === "booking" ? "booking_status" : "order_status";
      const purchaseStatus =
        found.type === "booking" ? "pending_confirmation" : "processing";
      await supabaseRest(found.table, "PATCH", {
        query: `id=eq.${encodeURIComponent(purchase.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
        body: {
          [statusField]: purchaseStatus,
          payment_status: "paid",
          razorpay_payment_id: paymentId,
          paid_at: new Date().toISOString(),
        },
      });
      purchase.payment_status = "paid";
      purchase[statusField] = purchaseStatus;
      purchase.razorpay_payment_id = paymentId;
    }

    const receiptEmailSent =
      purchase.receipt_email_status === "sent"
        ? true
        : await sendPaymentReceipt(purchase, found.type);

    return sendJson(200, {
      paymentStatus: "paid",
      purchaseType: found.type,
      purchaseStatus:
        found.type === "booking" ? purchase.booking_status : purchase.order_status,
      receiptEmailSent,
    });
  } catch (error) {
    return handleError(error);
  }
};
