const contactDetails = {
  whatsappNumber: "918088155724",
  instagramUrl: "https://instagram.com/dr.aishwarya_gowda_",
  youtubeUrl: "https://youtube.com/@aishwaryakgowda2499?si=CScdcs8w73E-9D5C",
};

const supabaseConfig = {
  url: "https://nestxckkpbyfjpwsuiqu.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc3R4Y2trcGJ5Zmpwd3N1aXF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMzg5ODksImV4cCI6MjEwNzYxNDk4OX0.iAcLHZBIYL8QHT7eMmCogxLdzk-OwwrlzDxneh7rwkY",
};

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const accountAction = document.querySelector("#account-action");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const bookingForm = document.querySelector("#booking-form");
const bookingStatus = document.querySelector("#form-status");
const enquiryForm = document.querySelector("#enquiry-form");
const enquiryStatus = document.querySelector("#enquiry-status");
const productGrid = document.querySelector("#product-grid");
const cartItemsElement = document.querySelector("#cart-items");
const productCheckoutForm = document.querySelector("#product-checkout-form");
const shopCheckoutStatus = document.querySelector("#shop-checkout-status");
const dateInput = document.querySelector("#date");
const cart = new Map();
let products = [];

const socialUrls = {
  whatsapp: `https://wa.me/${contactDetails.whatsappNumber}`,
  instagram: contactDetails.instagramUrl,
  youtube: contactDetails.youtubeUrl,
};

document.querySelectorAll("[data-social]").forEach((link) => {
  const url = socialUrls[link.dataset.social];
  if (url) {
    link.href = url;
  } else {
    link.hidden = true;
  }
});

document.querySelector("#year").textContent = new Date().getFullYear();

const today = new Date();
dateInput.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
    mainNav.classList.toggle("is-open", !isOpen);
  });

  mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mainNav.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open navigation");
    });
  });
}

const supabaseSdk = window.supabase;
if (!supabaseSdk?.createClient) {
  throw new Error("Supabase client did not load. Check the network and reload the page.");
}

const supabaseClient = supabaseSdk.createClient(supabaseConfig.url, supabaseConfig.anonKey);
let currentSession = null;
let currentProfile = null;
let authMode = "login";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

function renderProducts() {
  productGrid.replaceChildren();
  if (products.length === 0) {
    const empty = document.createElement("p");
    empty.className = "shop-status";
    empty.textContent = "No products are currently available.";
    productGrid.append(empty);
    return;
  }

  products.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "product-card";
    const art = document.createElement("div");
    art.className = `product-art product-art-${(index % 2) + 1}`;
    art.setAttribute("aria-hidden", "true");
    const symbol = document.createElement("span");
    symbol.textContent = index % 2 === 0 ? "✳" : "◌";
    art.append(symbol);
    const detail = document.createElement("div");
    detail.className = "product-detail";
    const pack = document.createElement("p");
    pack.className = "product-pack";
    pack.textContent = product.pack_size;
    const title = document.createElement("h3");
    title.textContent = product.name;
    const description = document.createElement("p");
    description.className = "product-description";
    description.textContent = product.description;
    const action = document.createElement("div");
    action.className = "product-action";
    const price = document.createElement("strong");
    price.textContent = formatRupees(product.price_paise);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "button button-dark product-add";
    add.textContent = "Add to basket";
    add.addEventListener("click", () => addToBasket(product.id));
    action.append(price, add);
    detail.append(pack, title, description, action);
    card.append(art, detail);
    productGrid.append(card);
  });
}

function formatRupees(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("id, name, pack_size, description, price_paise")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    productGrid.replaceChildren();
    const status = document.createElement("p");
    status.className = "shop-status";
    status.textContent = "The shop is being set up. Please check back soon.";
    productGrid.append(status);
    console.error("Could not load product catalogue", error.message);
    return;
  }

  products = data ?? [];
  renderProducts();
}

loadProducts().catch((error) => {
  productGrid.replaceChildren();
  const status = document.createElement("p");
  status.className = "shop-status";
  status.textContent = "The product list could not be loaded. Please try again later.";
  productGrid.append(status);
  console.error("Could not load product catalogue", error.message);
});

function addToBasket(productId) {
  const item = cart.get(productId);
  if (item) {
    if (item.quantity >= 10) {
      setStatus(shopCheckoutStatus, "You can add up to 10 of each product per order.", true);
      return;
    }
    item.quantity += 1;
  } else {
    cart.set(productId, { quantity: 1 });
  }
  shopCheckoutStatus.textContent = "";
  renderBasket();
  productCheckoutForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderBasket() {
  cartItemsElement.replaceChildren();
  const basket = [...cart.entries()];
  let subtotal = 0;

  if (basket.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Your basket is empty.";
    cartItemsElement.append(empty);
  } else {
    basket.forEach(([productId, selection]) => {
      const product = products.find((entry) => entry.id === productId);
      if (!product) return;
      subtotal += product.price_paise * selection.quantity;
      const row = document.createElement("div");
      row.className = "cart-item";
      const label = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = product.name;
      const pack = document.createElement("span");
      pack.textContent = `${product.pack_size} · ${formatRupees(product.price_paise)} each`;
      label.append(title, pack);
      const controls = document.createElement("div");
      controls.className = "cart-controls";
      const decrement = document.createElement("button");
      decrement.type = "button";
      decrement.textContent = "−";
      decrement.setAttribute("aria-label", `Remove one ${product.name}`);
      decrement.addEventListener("click", () => changeQuantity(productId, -1));
      const quantity = document.createElement("span");
      quantity.textContent = String(selection.quantity);
      const increment = document.createElement("button");
      increment.type = "button";
      increment.textContent = "+";
      increment.setAttribute("aria-label", `Add one ${product.name}`);
      increment.addEventListener("click", () => changeQuantity(productId, 1));
      controls.append(decrement, quantity, increment);
      row.append(label, controls);
      cartItemsElement.append(row);
    });
  }

  const shipping = basket.length ? 5000 : 0;
  document.querySelector("#cart-subtotal").textContent = formatRupees(subtotal);
  document.querySelector("#cart-shipping").textContent = formatRupees(shipping);
  document.querySelector("#cart-total").textContent = formatRupees(subtotal + shipping);
}

function changeQuantity(productId, delta) {
  const item = cart.get(productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart.delete(productId);
  if (item.quantity > 10) item.quantity = 10;
  renderBasket();
}

function setBookingFunctionError(error) {
  return error.message || "Could not complete this request. Please try again.";
}

renderBasket();

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.dataset.error = String(isError);
}

function showAuth(mode = "login") {
  setAuthMode(mode);
  authStatus.textContent = "";
  if (!authDialog.open) authDialog.showModal();
  document.querySelector("#auth-email").focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignUp = mode === "signup";
  document.querySelector("#auth-title").innerHTML = isSignUp
    ? "Create your <em>account.</em>"
    : "Welcome <em>in.</em>";
  document.querySelector("#auth-profile-fields").hidden = !isSignUp;
  document.querySelector("#auth-name").required = isSignUp;
  document.querySelector("#auth-phone").required = isSignUp;
  document.querySelector("#auth-password").autocomplete = isSignUp
    ? "new-password"
    : "current-password";
  document.querySelector("#auth-submit").innerHTML = isSignUp
    ? "Create account <span aria-hidden=\"true\">↗</span>"
    : "Log in <span aria-hidden=\"true\">↗</span>";

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function updateAccountButton() {
  accountAction.textContent = currentSession ? "Log out" : "Log in";
  accountAction.setAttribute(
    "aria-label",
    currentSession ? `Log out ${currentSession.user.email}` : "Log in to your account",
  );
  if (currentSession) {
    document.querySelector("#booking-email").value = currentSession.user.email ?? "";
    document.querySelector("#booking-email").readOnly = true;
  } else {
    document.querySelector("#booking-email").value = "";
  }
}

function fillBookingProfile() {
  if (!currentSession) return;
  const profile = currentProfile ?? {};
  document.querySelector("#name").value = profile.full_name ?? "";
  document.querySelector("#phone").value = profile.phone ?? "";
  document.querySelector("#booking-email").value = currentSession.user.email ?? "";
}

async function saveProfile(user, values) {
  const profile = {
    id: user.id,
    full_name: values.full_name,
    phone: values.phone,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select("id, full_name, phone")
    .single();

  if (error) throw new Error(`Could not save your account details: ${error.message}`);
  currentProfile = data;
  fillBookingProfile();
  return data;
}

async function loadProfile(user) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Could not load your saved account details: ${error.message}`);
  currentProfile = data;
  fillBookingProfile();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  currentSession = session;
  updateAccountButton();
  if (!session) {
    currentProfile = null;
    return;
  }
  queueMicrotask(() => {
    loadProfile(session.user).catch((error) => {
      setStatus(authStatus, error.message, true);
    });
  });
});

supabaseClient.auth
  .getSession()
  .then(async ({ data, error }) => {
    if (error) throw error;
    currentSession = data.session;
    updateAccountButton();
    if (currentSession) await loadProfile(currentSession.user);
  })
  .catch((error) => {
    setStatus(authStatus, `Could not restore your account session: ${error.message}`, true);
  });

accountAction.addEventListener("click", async () => {
  if (!currentSession) {
    showAuth("login");
    return;
  }

  accountAction.disabled = true;
  const { error } = await supabaseClient.auth.signOut();
  accountAction.disabled = false;
  if (error) {
    setStatus(authStatus, `Could not log out: ${error.message}`, true);
    return;
  }
  setStatus(bookingStatus, "You’re logged out. Log in again to book an appointment.");
});

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.authMode);
    authStatus.textContent = "";
  });
});

document.querySelector("#auth-close").addEventListener("click", () => authDialog.close());
authDialog.addEventListener("click", (event) => {
  if (event.target === authDialog) authDialog.close();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = document.querySelector("#auth-submit");
  const values = new FormData(authForm);
  const email = String(values.get("email")).trim().toLowerCase();
  const password = String(values.get("password"));
  submitButton.disabled = true;
  authStatus.textContent = "";

  try {
    let session;
    let user;

    if (authMode === "signup") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: String(values.get("name")).trim(),
            phone: String(values.get("phone")).trim(),
          },
        },
      });
      if (error) throw error;
      session = data.session;
      user = data.user;
      if (!session) {
        setStatus(
          authStatus,
          "Check your email to confirm your account, then log in before booking.",
        );
        return;
      }
      await saveProfile(user, {
        full_name: String(values.get("name")).trim(),
        phone: String(values.get("phone")).trim(),
      });
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      user = data.user;
      await loadProfile(user);
    }

    currentSession = session;
    updateAccountButton();
    fillBookingProfile();
    authDialog.close();
    setStatus(bookingStatus, "You’re signed in. Review your details and continue to payment.");
    setStatus(enquiryStatus, "You’re signed in. Submit your enquiry to save it and open WhatsApp.");
  } catch (error) {
    setStatus(authStatus, error.message || "Could not complete account sign-in.", true);
  } finally {
    submitButton.disabled = false;
  }
});

async function callFunction(name, body, accessToken) {
  const response = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function getAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error("Please log in to continue.");
  currentSession = data.session;
  updateAccountButton();
  return data.session.access_token;
}

async function startCheckout({ type, details, statusElement, submitButton }) {
  const accessToken = await getAccessToken();
  const order = await callFunction(
    "create-order",
    { type, ...details },
    accessToken,
  );
  const description =
    type === "appointment"
      ? `${details.service} appointment`
      : "Wellness products";
  const orderReference = order.razorpayOrderId;

  if (!window.Razorpay) {
    throw new Error("Razorpay Checkout did not load. Check your connection and try again.");
  }

  const checkout = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    name: "Dr Aishwarya Wellness",
    description,
    order_id: orderReference,
    prefill: {
      name: details.fullName,
      email: currentSession.user.email,
      contact: details.phone,
    },
    notes: { purchase_id: order.purchaseId },
    theme: { color: "#314b3b" },
    modal: {
      ondismiss: () => {
        submitButton.disabled = false;
        setStatus(statusElement, "Payment was not completed. The order has not been confirmed.");
      },
    },
    handler: async (payment) => {
      setStatus(statusElement, "Payment received. Verifying it securely and saving your order…");
      try {
        const result = await callFunction("verify-payment", payment, accessToken);
        const receipt = result.receiptEmailSent
          ? " A payment receipt has been emailed to you."
          : " Your payment is recorded, but the receipt email could not be sent automatically. Please contact us for a copy.";
        const confirmation =
          type === "appointment"
            ? "Your appointment request is saved and pending availability confirmation."
            : "Your product order is saved and being prepared for delivery.";
        setStatus(statusElement, `Payment confirmed. ${confirmation}${receipt}`);

        if (type === "appointment") {
          bookingForm.reset();
          fillBookingProfile();
        } else {
          cart.clear();
          renderBasket();
          productCheckoutForm.reset();
        }
      } catch (error) {
        setStatus(
          statusElement,
          `The payment window returned, but confirmation could not be completed: ${error.message} If you were charged, contact us on WhatsApp before trying again.`,
          true,
        );
      } finally {
        submitButton.disabled = false;
      }
    },
  });

  checkout.on("payment.failed", (payment) => {
    const description = payment.error?.description || "Please try again or contact us.";
    setStatus(statusElement, `Payment was not completed: ${description}`, true);
    submitButton.disabled = false;
  });
  checkout.open();
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!bookingForm.reportValidity()) return;

  const booking = Object.fromEntries(new FormData(bookingForm));
  if (!currentSession) {
    setStatus(bookingStatus, "Log in or create an account to save your appointment and continue.");
    showAuth("login");
    return;
  }

  const submitButton = bookingForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await startCheckout({
      type: "appointment",
      details: {
        service: booking.service,
        appointmentDate: booking.date,
        preferredTime: booking.time,
        fullName: booking.name,
        phone: booking.phone,
      },
      statusElement: bookingStatus,
      submitButton,
    });
  } catch (error) {
    setStatus(bookingStatus, setBookingFunctionError(error), true);
    submitButton.disabled = false;
  }
});

productCheckoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!productCheckoutForm.reportValidity()) return;
  if (cart.size === 0) {
    setStatus(shopCheckoutStatus, "Add a product to your basket before checkout.", true);
    return;
  }
  if (!currentSession) {
    setStatus(shopCheckoutStatus, "Log in or create an account to save your delivery details and order.");
    showAuth("login");
    return;
  }

  const values = Object.fromEntries(new FormData(productCheckoutForm));
  const submitButton = productCheckoutForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await startCheckout({
      type: "product",
      details: {
        fullName: currentProfile?.full_name ?? "",
        phone: currentProfile?.phone ?? "",
        items: [...cart.entries()].map(([productId, selection]) => ({
          productId,
          quantity: selection.quantity,
        })),
        address: values.address,
        city: values.city,
        state: values.state,
        pincode: values.pincode,
      },
      statusElement: shopCheckoutStatus,
      submitButton,
    });
  } catch (error) {
    setStatus(shopCheckoutStatus, setBookingFunctionError(error), true);
    submitButton.disabled = false;
  }
});

enquiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!enquiryForm.reportValidity()) return;
  const message = String(new FormData(enquiryForm).get("message")).trim();
  if (!currentSession) {
    setStatus(enquiryStatus, "Log in or create an account to save your enquiry and continue to WhatsApp.");
    showAuth("login");
    return;
  }

  const submitButton = enquiryForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  enquiryStatus.textContent = "";

  try {
    const accessToken = await getAccessToken();
    const result = await callFunction("create-enquiry", { message }, accessToken);
    const whatsappMessage = [
      "Hello Dr Aishwarya Wellness, I have an enquiry.",
      "",
      `Name: ${result.fullName}`,
      `Email: ${result.email}`,
      `Phone: ${result.phone}`,
      `Enquiry: ${message}`,
      `Reference: ${result.enquiryId}`,
    ].join("\n");
    window.location.assign(
      `${socialUrls.whatsapp}?text=${encodeURIComponent(whatsappMessage)}`,
    );
  } catch (error) {
    setStatus(enquiryStatus, error.message || "Could not save your enquiry.", true);
    submitButton.disabled = false;
  }
});
