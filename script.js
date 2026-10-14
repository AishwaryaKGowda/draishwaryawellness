// Add the center's real contact details before publishing the live site.
const contactDetails = {
  whatsappNumber: "918088155724",
  instagramUrl: "https://instagram.com/dr.aishwarya_gowda_",
  facebookUrl: "https://www.facebook.com/YOUR_PAGE/",
};

const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");

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

const socialUrls = {
  whatsapp: `https://wa.me/${contactDetails.whatsappNumber}`,
  instagram: contactDetails.instagramUrl,
  facebook: contactDetails.facebookUrl,
};

document.querySelectorAll("[data-social]").forEach((link) => {
  link.href = socialUrls[link.dataset.social];
});

document.querySelector("#year").textContent = new Date().getFullYear();

const dateInput = document.querySelector("#date");
const today = new Date();
dateInput.min = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);

document.querySelector("#booking-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const form = new FormData(event.currentTarget);
  const appointmentMessage = [
    "Hello Dr Aishwarya Wellness, I'd like to request an appointment.",
    "",
    `Name: ${form.get("name")}`,
    `Phone: ${form.get("phone")}`,
    `Care: ${form.get("service")}`,
    `Preferred date: ${form.get("date")}`,
    form.get("message") ? `Note: ${form.get("message")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const whatsappUrl = `https://wa.me/${contactDetails.whatsappNumber}?text=${encodeURIComponent(appointmentMessage)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  document.querySelector("#form-status").textContent =
    "Your appointment request is ready in WhatsApp. Send the message there to complete your request.";
});
