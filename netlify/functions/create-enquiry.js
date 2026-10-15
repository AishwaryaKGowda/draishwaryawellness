const {
  HttpError,
  getAuthenticatedUser,
  handleError,
  parseJsonBody,
  requireEnv,
  requireMethod,
  sendJson,
  supabaseRest,
} = require("../lib/server");

exports.handler = async (event) => {
  try {
    requireMethod(event, "POST");
    requireEnv(
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    const user = await getAuthenticatedUser(event);
    const body = parseJsonBody(event);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 3 || message.length > 1200) {
      throw new HttpError(400, "Enter an enquiry between 3 and 1,200 characters.");
    }

    const profiles = await supabaseRest("profiles", "GET", {
      query: `select=full_name,phone&id=eq.${encodeURIComponent(user.id)}&limit=1`,
    });
    const profile = profiles?.[0];
    if (!profile?.full_name || !profile?.phone) {
      throw new HttpError(400, "Add your name and phone number to your account before sending an enquiry.");
    }

    const rows = await supabaseRest("enquiries", "POST", {
      prefer: "return=representation",
      body: {
        user_id: user.id,
        email: user.email,
        full_name: profile.full_name,
        phone: profile.phone,
        message,
      },
    });
    const enquiry = rows?.[0];
    if (!enquiry?.id) throw new HttpError(502, "Could not save your enquiry.");

    return sendJson(200, {
      enquiryId: enquiry.id,
      fullName: profile.full_name,
      phone: profile.phone,
      email: user.email,
    });
  } catch (error) {
    return handleError(error);
  }
};
