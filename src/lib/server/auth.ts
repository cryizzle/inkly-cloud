import { timingSafeEqual } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

const COOKIE_NAME = 'inkly_token';

function configuredToken() {
	return process.env.INKLY_ACCESS_TOKEN?.trim() ?? '';
}

export function isAuthEnabled() {
	return configuredToken().length > 0;
}

export function assertProductionAuthConfigured() {
	if (
		process.env.NODE_ENV === 'production' &&
		!configuredToken() &&
		process.env.INKLY_ALLOW_NO_TOKEN !== 'true'
	) {
		throw new Error('INKLY_ACCESS_TOKEN must be set in production.');
	}
}

export function tokenCookieName() {
	return COOKIE_NAME;
}

export function isValidToken(candidate: string | null | undefined) {
	const expected = configuredToken();
	if (!expected) return true;
	if (!candidate) return false;

	const expectedBuffer = Buffer.from(expected);
	const candidateBuffer = Buffer.from(candidate);
	return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
}

export function readBearerToken(event: RequestEvent) {
	const authorization = event.request.headers.get('authorization');
	if (authorization?.toLowerCase().startsWith('bearer ')) {
		return authorization.slice('bearer '.length).trim();
	}

	return event.request.headers.get('x-inkly-token')?.trim() ?? null;
}

export function isAuthenticated(event: RequestEvent) {
	return isValidToken(readBearerToken(event)) || isValidToken(event.cookies.get(COOKIE_NAME));
}

function shouldUseSecureCookies() {
	if (process.env.INKLY_COOKIE_SECURE) {
		return process.env.INKLY_COOKIE_SECURE === 'true';
	}

	return process.env.ORIGIN?.startsWith('https://') ?? process.env.NODE_ENV === 'production';
}

export function setAuthCookie(cookies: Cookies, token: string) {
	cookies.set(COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: shouldUseSecureCookies(),
		maxAge: 60 * 60 * 24 * 365
	});
}

export function clearAuthCookie(cookies: Cookies) {
	cookies.delete(COOKIE_NAME, { path: '/' });
}
