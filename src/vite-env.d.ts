/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DONATION_INJ?: string;
	readonly VITE_DONATION_ETH?: string;
	readonly VITE_DONATION_BTC?: string;
	readonly VITE_IGNITE_MP_SERVER?: string;
	readonly VITE_IGNITE_POLICY_SERVER?: string;
	readonly VITE_IGNITE_POLICY_CANONICAL_URL?: string;
	readonly VITE_IGNITE_POLICY_FETCH_URLS?: string;
	readonly VITE_IGNITE_POLICY_SYNC_URLS?: string;
	readonly VITE_IGNITE_BOT_POLICY_GITHUB_REPO?: string;
	readonly VITE_IGNITE_BOT_POLICY_GITHUB_BRANCH?: string;
	readonly VITE_IGNITE_BOT_POLICY_GITHUB_PATH?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module "*.wasm?url" {
	const url: string;
	export default url;
}
