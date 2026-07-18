/** Tekst w menu — zawsze lokalny (i18n można dodać później). */
export const DONATION_TAGLINE = "Prąd kosztuje. Rząd się sam nie wyżywi.";

export const DONATION_VERIFY_URL_DEFAULT = "https://codeberg.org/Adam-LX";

const WALLET_DEFS = [
	{ symbol: "INJ", label: "Injective", envKey: "VITE_DONATION_INJ" },
	{ symbol: "ETH", label: "Ethereum", envKey: "VITE_DONATION_ETH" },
	{ symbol: "BTC", label: "Bitcoin", envKey: "VITE_DONATION_BTC" },
] as const;

export type DonationWallet = {
	symbol: string;
	label: string;
	address: string;
};

export type DonationConfig = {
	tagline: string;
	wallets: DonationWallet[];
	verifyUrl: string;
};

type DonationJson = {
	wallets?: Array<{ symbol?: string; label?: string; address?: string }>;
	verifyUrl?: string;
};

let cached: DonationConfig | null = null;

function envAddress(envKey: (typeof WALLET_DEFS)[number]["envKey"]): string {
	const raw = import.meta.env[envKey];
	return typeof raw === "string" ? raw.trim() : "";
}

function walletsFromAddresses(bySymbol: Map<string, string>): DonationWallet[] {
	return WALLET_DEFS.map((def) => ({
		symbol: def.symbol,
		label: def.label,
		address: bySymbol.get(def.symbol) ?? "",
	}));
}

function seedAddresses(): Map<string, string> {
	const map = new Map<string, string>();
	for (const def of WALLET_DEFS) {
		const addr = envAddress(def.envKey);
		if (addr) map.set(def.symbol, addr);
	}
	return map;
}

/** @deprecated użyj loadDonationConfig() */
export const DONATION = {
	tagline: DONATION_TAGLINE,
	get wallets(): DonationWallet[] {
		return walletsFromAddresses(seedAddresses());
	},
} as const;

export function activeDonationWallets(
	wallets: DonationWallet[],
): DonationWallet[] {
	return wallets.filter((w) => w.address.length > 0);
}

export function truncateAddress(addr: string, head = 6, tail = 4): string {
	if (!addr) return "—";
	if (addr.length <= head + tail + 3) return addr;
	return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Portfele z /donation.json (build) z fallbackiem na VITE_DONATION_* (dev). */
export async function loadDonationConfig(): Promise<DonationConfig> {
	if (cached) return cached;

	const bySymbol = seedAddresses();

	try {
		const res = await fetch("/donation.json", { cache: "no-store" });
		if (res.ok) {
			const data = (await res.json()) as DonationJson;
			for (const row of data.wallets ?? []) {
				const symbol = row.symbol?.trim();
				const address = row.address?.trim() ?? "";
				if (symbol && address) bySymbol.set(symbol, address);
			}
			cached = {
				tagline: DONATION_TAGLINE,
				wallets: walletsFromAddresses(bySymbol),
				verifyUrl: data.verifyUrl?.trim() || DONATION_VERIFY_URL_DEFAULT,
			};
			return cached;
		}
	} catch {
		/* dev bez pliku / file:// */
	}

	cached = {
		tagline: DONATION_TAGLINE,
		wallets: walletsFromAddresses(bySymbol),
		verifyUrl: DONATION_VERIFY_URL_DEFAULT,
	};
	return cached;
}
