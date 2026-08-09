const CLIENT_ID_KEY = "ignite-mp-client-id";

export function getMpClientId(): string {
	try {
		let id = localStorage.getItem(CLIENT_ID_KEY);
		if (!id) {
			id = `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
			localStorage.setItem(CLIENT_ID_KEY, id);
		}
		return id;
	} catch {
		return "anon";
	}
}
