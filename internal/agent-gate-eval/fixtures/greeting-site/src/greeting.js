/** The greeting the home page renders for a visitor, with a farewell line under it. */
export function renderGreeting(visitorName) {
  const name = visitorName && visitorName.trim() ? visitorName.trim() : "friend";
  return `<h1>Hello, ${name}!</h1>\n<p>See you soon, ${name}!</p>`;
}
