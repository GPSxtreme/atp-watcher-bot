import axios, { AxiosInstance, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";
import { env } from "../env";

export interface Holding {
	tokenContract: string;
	tokenAmount: string;
	name: string;
	currentPriceInUsd: number;
}

export interface HoldingsResponse {
	count: number;
	holdings: Holding[];
}

export interface PricesResponse {
	everipedia: {
		usd: number;
	};
}

export interface AgentInfo {
	id: string;
	avatar: {
		original: string;
		small: string;
		medium: string;
		large: string;
	};
	ticker: string;
	name: string;
	bio: string;
	framework: string;
	socials: Array<{
		url: string;
		name: string;
	}>;
	creatorId: string;
	isActive: boolean;
	governanceContract: string;
	tokenContract: string;
	managerContract: string;
	poolContract: string;
	agentContract: string;
	createdAt: string;
	updatedAt: string;
	tokenUri: string;
	knowledge: unknown[];
	model: string | null;
	category: string;
	currentPriceInIq: string;
	inferenceCount: number;
	holdersCount: number;
}

export interface AgentStats {
	currentPriceInIq: number;
	currentPriceInUSD: number;
	marketCap: number;
	changeIn24h: number;
	holdersCount: number;
	inferenceCount: number;
	category: string;
}

export interface TopAgent {
	tokenContract: string;
	agentContract: string;
	isActive: boolean;
	currentPriceInIq: number;
	holdersCount: number;
	inferenceCount: number;
	name: string;
	ticker: string;
	currentPriceInUSD: number;
}

export interface TopAgentsResponse {
	agents: TopAgent[];
}

export type SortBy = "mcap" | "holders" | "inferences";

class AgentsApiService {
	private api: AxiosInstance;

	constructor() {
		this.api = axios.create({
			baseURL: env.IQ_API_BASE_URL,
			timeout: 30000,
			headers: {
				"Content-Type": "application/json",
			},
		});

		axiosRetry(this.api, {
			retries: 3,
			retryDelay: axiosRetry.exponentialDelay,
			retryCondition: (error) => {
				return (
					axiosRetry.isNetworkOrIdempotentRequestError(error) ||
					error.response?.status === 429 ||
					error.response?.status === 503
				);
			},
		});

		this.api.interceptors.request.use((config) => {
			console.log(
				`🔄 API Request: ${config.method?.toUpperCase()} ${config.url}`,
			);
			return config;
		});

		this.api.interceptors.response.use(
			(response) => {
				console.log(
					`✅ API Response: ${response.status} ${response.config.url}`,
				);
				return response;
			},
			(error) => {
				console.error(`❌ API Error: ${error.message}`);
				if (error.response) {
					console.error(`   Status: ${error.response.status}`);
					console.error(`   Data: ${JSON.stringify(error.response.data)}`);
				}
				return Promise.reject(error);
			},
		);
	}

	async getHoldings(address: string): Promise<HoldingsResponse> {
		try {
			const response: AxiosResponse<HoldingsResponse> = await this.api.get(
				"/holdings",
				{
					params: { address },
				},
			);
			return response.data;
		} catch (error) {
			console.error("Error fetching holdings:", error);
			throw error;
		}
	}

	async getPrices(): Promise<PricesResponse> {
		try {
			const response: AxiosResponse<PricesResponse> =
				await this.api.get("/prices");
			return response.data;
		} catch (error) {
			console.error("Error fetching prices:", error);
			throw error;
		}
	}

	async getAgentInfo(address: string): Promise<AgentInfo> {
		try {
			const response: AxiosResponse<AgentInfo> = await this.api.get(
				"/agents/info",
				{
					params: { address },
				},
			);
			return response.data;
		} catch (error) {
			console.error("Error fetching agent info:", error);
			throw error;
		}
	}

	async getAgentStats(address: string): Promise<AgentStats> {
		try {
			const response: AxiosResponse<AgentStats> = await this.api.get(
				"/agents/stats",
				{
					params: { address },
				},
			);
			return response.data;
		} catch (error) {
			console.error("Error fetching agent stats:", error);
			throw error;
		}
	}

	async getTopAgents(
		sort: SortBy = "mcap",
		limit: number = 15,
	): Promise<TopAgentsResponse> {
		try {
			const response: AxiosResponse<TopAgentsResponse> = await this.api.get(
				"/agents/top",
				{
					params: { sort, limit },
				},
			);
			return response.data;
		} catch (error) {
			console.error("Error fetching top agents:", error);
			throw error;
		}
	}

	calculateHoldingsValue(holdings: Holding[]): number {
		return holdings.reduce((total, holding) => {
			const amount = parseFloat(holding.tokenAmount);
			return total + amount * holding.currentPriceInUsd;
		}, 0);
	}

	formatCurrency(amount: number): string {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
			maximumFractionDigits: 6,
		}).format(amount);
	}

	formatTokenAmount(amount: string): string {
		const num = parseFloat(amount);
		if (num >= 1000000) {
			return `${(num / 1000000).toFixed(2)}M`;
		} else if (num >= 1000) {
			return `${(num / 1000).toFixed(2)}K`;
		} else {
			return num.toFixed(2);
		}
	}

	calculatePercentageChange(oldValue: number, newValue: number): number {
		if (oldValue === 0) return 0;
		return ((newValue - oldValue) / oldValue) * 100;
	}
}

export const agentsApi = new AgentsApiService();
export default agentsApi;
