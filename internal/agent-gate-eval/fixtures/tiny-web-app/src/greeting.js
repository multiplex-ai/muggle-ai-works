/** The greeting the home page renders for a visitor. */
export function renderGreeting(visitorName) {
  const name = visitorName && visitorName.trim() ? visitorName.trim() : "friend";
  return `<h1>Hello, ${name}!</h1>`;
}
