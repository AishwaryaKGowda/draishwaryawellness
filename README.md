# Dr Aishwarya Wellness

A responsive, static website for Dr Aishwarya Wellness. It uses plain HTML, CSS,
and JavaScript and has no package dependencies or build step.

## Preview

Open `index.html` in a browser, or serve the project directory with any static
web server.

## Configure contact and booking

Before publishing, edit the `contactDetails` object near the top of `script.js`:

- `whatsappNumber`: WhatsApp number in international format, digits only,
  including country code (for example, `91...`).
- `instagramUrl`: the center's Instagram profile URL.
- `facebookUrl`: the center's Facebook page URL.

The appointment form prepares a WhatsApp message with the visitor's requested
appointment details. The visitor must send that message in WhatsApp to complete
the request. No booking data is stored by this static website.

## Publish

The files can be hosted on GitHub Pages or another static hosting provider. No
dependency installation is required.
