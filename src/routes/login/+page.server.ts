import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { clearAuthCookie, isAuthEnabled, isValidToken, setAuthCookie } from '$lib/server/auth';

export const load: PageServerLoad = async ({ url }) => {
	if (!isAuthEnabled()) {
		throw redirect(303, '/');
	}

	return {
		next: url.searchParams.get('next') ?? '/'
	};
};

export const actions: Actions = {
	login: async ({ cookies, request }) => {
		const formData = await request.formData();
		const token = String(formData.get('token') ?? '');
		const next = String(formData.get('next') ?? '/');

		if (!isValidToken(token)) {
			return fail(401, {
				message: 'That token did not work.',
				next
			});
		}

		setAuthCookie(cookies, token);
		throw redirect(303, next.startsWith('/') ? next : '/');
	},
	logout: async ({ cookies }) => {
		clearAuthCookie(cookies);
		throw redirect(303, '/login');
	}
};
