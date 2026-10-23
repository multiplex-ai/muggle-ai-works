/** The contact page's message form. */
function renderContactPage() {
  return `<h1>Contact us</h1>\n<form method="post" action="/contact"><textarea name="message" required></textarea><button>Send</button></form>`;
}

/** The note a sent message lands on. */
function renderContactThanks() {
  return "<p>Thanks — we'll get back to you soon.</p>";
}

/** The contact page's routes, keyed by method and path. */
export const contactRoutes = {
  "GET /contact": renderContactPage,
  "POST /contact": renderContactThanks,
};
