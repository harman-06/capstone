// Time-of-day greeting shown at the top of every dashboard.
export function timeGreeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// "Dr. Smith" keeps its title; everyone else is greeted by first name.
// If the account has no name, the fallback (usually the role) is used.
export function displayName(full, fallback = '') {
  const name = String(full ?? '').trim();
  if (!name) return fallback;
  if (/^(dr|prof)\.?\s/i.test(name)) return name;
  return name.split(/\s+/)[0];
}

export const greeting = (name, fallback = '', date) => `${timeGreeting(date)}, ${displayName(name, fallback)}`;
