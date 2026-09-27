// Serveren kører som administrator. Disse tjek holder fremmede hjemmesider
// (CSRF, DNS-rebinding) ude, selvom de kan nå 127.0.0.1 fra din browser.
import { timingSafeEqual } from 'node:crypto';

const localOrigins = (port) => [`127.0.0.1:${port}`, `localhost:${port}`];

export function hostAllowed(host, port) {
  return localOrigins(port).includes(String(host));
}

export function originAllowed(origin, port) {
  return !origin || localOrigins(port).some((local) => origin === `http://${local}`);
}

export function tokenMatches(given, expected) {
  const givenBuffer = Buffer.from(String(given ?? ''));
  const expectedBuffer = Buffer.from(expected);
  return givenBuffer.length === expectedBuffer.length && timingSafeEqual(givenBuffer, expectedBuffer);
}
