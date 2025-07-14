import { EventEmitter } from "node:events";
import { env } from "../env";
import { agentsApi } from "./agents";
import { database } from "./database";

export interface PriceAlert {
	type:
		| "price_increase"
		| "price_decrease"
		| "significant_change"
		| "minor_change"
		| "major_change"
		| "critical_change";
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	tokenContract: string;
	tokenName: string;
	currentPrice: number;
	previousPrice: number;
	change: number;
	changePercentage: number;
	threshold: number;
	timestamp: Date;
}

interface ThresholdConfig {
	minor: number; // 1-5% changes
	major: number; // 5-15% changes
	critical: number; // 15%+ changes
}

interface TokenWatchConfig {
	tokenContract: string;
	tokenName: string;
	thresholds: ThresholdConfig;
	checkInterval: number;
	enableMinorAlerts: boolean;
	enableMajorAlerts: boolean;
	enableCriticalAlerts: boolean;
}

interface TrackedToken {
	config: TokenWatchConfig;
	lastPrice: number;
	lastCheckTime: Date;
	intervalId: NodeJS.Timeout | null;
}

export class PriceWatcher extends EventEmitter {
	private trackedTokens: Map<string, TrackedToken> = new Map();
	private isRunning: boolean = false;

	async start(): Promise<void> {
		if (this.isRunning) {
			console.log("💡 Price watcher is already running");
			return;
		}

		console.log("🚀 Starting price watcher service");
		this.isRunning = true;

		// Load existing watched tokens from database
		const watchedTokens = database.getWatchedTokens(true);
		console.log(
			`📊 Loading ${watchedTokens.length} watched tokens from database`,
		);

		for (const dbToken of watchedTokens) {
			const trackedToken: TrackedToken = {
				config: {
					tokenContract: dbToken.tokenContract,
					tokenName: dbToken.tokenName,
					thresholds: {
						minor: dbToken.minorThreshold,
						major: dbToken.majorThreshold,
						critical: dbToken.criticalThreshold,
					},
					checkInterval: dbToken.checkInterval,
					enableMinorAlerts: dbToken.enableMinorAlerts,
					enableMajorAlerts: dbToken.enableMajorAlerts,
					enableCriticalAlerts: dbToken.enableCriticalAlerts,
				},
				lastPrice: dbToken.lastPrice,
				lastCheckTime: new Date(dbToken.lastCheckTime),
				intervalId: null,
			};
			this.trackedTokens.set(dbToken.tokenContract, trackedToken);
		}

		// Start tracking all loaded tokens
		for (const [tokenContract, token] of this.trackedTokens) {
			await this.startTrackingToken(tokenContract);
		}

		this.emit("started");
	}

	async stop(): Promise<void> {
		if (!this.isRunning) {
			console.log("💡 Price watcher is already stopped");
			return;
		}

		console.log("🛑 Stopping price watcher service");
		this.isRunning = false;

		for (const [tokenContract] of this.trackedTokens) {
			await this.stopTrackingToken(tokenContract);
		}

		this.emit("stopped");
	}

	async addToken(
		tokenContract: string,
		tokenName: string,
		priceChangeThreshold: number = env.DEFAULT_PRICE_CHANGE_THRESHOLD,
		checkInterval: number = env.PRICE_CHECK_INTERVAL,
	): Promise<void> {
		if (this.trackedTokens.has(tokenContract)) {
			console.log(`💡 Token ${tokenName} is already being tracked`);
			return;
		}

		const config: TokenWatchConfig = {
			tokenContract,
			tokenName,
			thresholds: {
				minor: priceChangeThreshold,
				major: priceChangeThreshold * 3, // Default to 3x minor for major
				critical: priceChangeThreshold * 5, // Default to 5x minor for critical
			},
			checkInterval,
			enableMinorAlerts: true,
			enableMajorAlerts: true,
			enableCriticalAlerts: true,
		};

		try {
			const stats = await agentsApi.getAgentStats(tokenContract);
			const trackedToken: TrackedToken = {
				config,
				lastPrice: stats.currentPriceInUSD,
				lastCheckTime: new Date(),
				intervalId: null,
			};

			this.trackedTokens.set(tokenContract, trackedToken);

			// Persist to database
			database.addWatchedToken({
				tokenContract,
				tokenName,
				priceChangeThreshold,
				minorThreshold: priceChangeThreshold,
				majorThreshold: priceChangeThreshold * 3,
				criticalThreshold: priceChangeThreshold * 5,
				checkInterval,
				lastPrice: stats.currentPriceInUSD,
				lastCheckTime: Date.now(),
				isActive: true,
				enableMinorAlerts: true,
				enableMajorAlerts: true,
				enableCriticalAlerts: true,
			});

			console.log(`✅ Added token ${tokenName} to tracking list`);
			console.log(
				`📊 Initial price: ${agentsApi.formatCurrency(stats.currentPriceInUSD)}`,
			);

			if (this.isRunning) {
				await this.startTrackingToken(tokenContract);
			}

			this.emit("token_added", {
				tokenContract,
				tokenName,
				initialPrice: stats.currentPriceInUSD,
			});
		} catch (error) {
			console.error(`❌ Error adding token ${tokenName}:`, error);
			throw error;
		}
	}

	async addTokenAdvanced(
		tokenContract: string,
		tokenName: string,
		thresholds: ThresholdConfig,
		checkInterval: number = env.PRICE_CHECK_INTERVAL,
	): Promise<void> {
		if (this.trackedTokens.has(tokenContract)) {
			console.log(`💡 Token ${tokenName} is already being tracked`);
			return;
		}

		const config: TokenWatchConfig = {
			tokenContract,
			tokenName,
			thresholds,
			checkInterval,
			enableMinorAlerts: true,
			enableMajorAlerts: true,
			enableCriticalAlerts: true,
		};

		try {
			const stats = await agentsApi.getAgentStats(tokenContract);
			const trackedToken: TrackedToken = {
				config,
				lastPrice: stats.currentPriceInUSD,
				lastCheckTime: new Date(),
				intervalId: null,
			};

			this.trackedTokens.set(tokenContract, trackedToken);

			// Persist to database
			database.addWatchedToken({
				tokenContract,
				tokenName,
				priceChangeThreshold: thresholds.minor, // Use minor as default
				minorThreshold: thresholds.minor,
				majorThreshold: thresholds.major,
				criticalThreshold: thresholds.critical,
				checkInterval,
				lastPrice: stats.currentPriceInUSD,
				lastCheckTime: Date.now(),
				isActive: true,
				enableMinorAlerts: true,
				enableMajorAlerts: true,
				enableCriticalAlerts: true,
			});

			console.log(
				`✅ Added token ${tokenName} to tracking list with advanced configuration`,
			);
			console.log(
				`📊 Initial price: ${agentsApi.formatCurrency(stats.currentPriceInUSD)}`,
			);
			console.log(
				`📊 Thresholds - Minor: ${thresholds.minor}%, Major: ${thresholds.major}%, Critical: ${thresholds.critical}%`,
			);

			if (this.isRunning) {
				await this.startTrackingToken(tokenContract);
			}

			this.emit("token_added", {
				tokenContract,
				tokenName,
				initialPrice: stats.currentPriceInUSD,
			});
		} catch (error) {
			console.error(`❌ Error adding token ${tokenName}:`, error);
			throw error;
		}
	}

	async removeToken(tokenContract: string): Promise<void> {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) {
			console.log(`💡 Token ${tokenContract} is not being tracked`);
			return;
		}

		await this.stopTrackingToken(tokenContract);
		this.trackedTokens.delete(tokenContract);

		// Mark as inactive in database
		database.removeWatchedToken(tokenContract);

		console.log(`🗑️  Removed token ${token.config.tokenName} from tracking`);
		this.emit("token_removed", {
			tokenContract,
			tokenName: token.config.tokenName,
		});
	}

	private async startTrackingToken(tokenContract: string): Promise<void> {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) return;

		if (token.intervalId) {
			clearInterval(token.intervalId);
		}

		console.log(`🔄 Starting price tracking for ${token.config.tokenName}`);
		console.log(`⏰ Check interval: ${token.config.checkInterval}s`);
		console.log(`📊 Price change threshold: ${token.config.thresholds.minor}%`);

		token.intervalId = setInterval(async () => {
			try {
				await this.checkTokenPrice(tokenContract);
			} catch (error) {
				console.error(
					`Error checking price for ${token.config.tokenName}:`,
					error,
				);
				this.emit("error", error);
			}
		}, token.config.checkInterval * 1000);

		await this.checkTokenPrice(tokenContract);
	}

	private async stopTrackingToken(tokenContract: string): Promise<void> {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) return;

		if (token.intervalId) {
			clearInterval(token.intervalId);
			token.intervalId = null;
		}

		console.log(`🛑 Stopped price tracking for ${token.config.tokenName}`);
	}

	private async checkTokenPrice(tokenContract: string): Promise<void> {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) return;

		try {
			const stats = await agentsApi.getAgentStats(tokenContract);
			const currentPrice = stats.currentPriceInUSD;
			const previousPrice = token.lastPrice;
			const change = currentPrice - previousPrice;
			const changePercentage = agentsApi.calculatePercentageChange(
				previousPrice,
				currentPrice,
			);

			console.log(
				`📊 ${token.config.tokenName}: ${agentsApi.formatCurrency(currentPrice)} (${changePercentage.toFixed(2)}%)`,
			);

			// Only send alerts if there's actually a price change
			if (Math.abs(changePercentage) === 0) {
				// No price change, skip alert
				return;
			}

			let alertType: PriceAlert["type"] = "significant_change";
			let alertSeverity: PriceAlert["severity"] = "medium";
			let threshold = 0;
			let shouldAlert = false;

			// Determine alert type based on threshold exceeded
			if (Math.abs(changePercentage) >= token.config.thresholds.critical) {
				alertType = "critical_change";
				alertSeverity = "critical";
				threshold = token.config.thresholds.critical;
				shouldAlert = token.config.enableCriticalAlerts;
			} else if (Math.abs(changePercentage) >= token.config.thresholds.major) {
				alertType = "major_change";
				alertSeverity = "high";
				threshold = token.config.thresholds.major;
				shouldAlert = token.config.enableMajorAlerts;
			} else if (Math.abs(changePercentage) >= token.config.thresholds.minor) {
				alertType = "minor_change";
				alertSeverity = "low";
				threshold = token.config.thresholds.minor;
				shouldAlert = token.config.enableMinorAlerts;
			}

			// Only send alert if threshold is exceeded and alerts are enabled
			if (shouldAlert && threshold > 0) {
				const alert: PriceAlert = {
					type: alertType,
					severity: alertSeverity,
					message: this.createPriceAlertMessage(
						token.config.tokenName,
						currentPrice,
						previousPrice,
						change,
						changePercentage,
						threshold,
					),
					tokenContract,
					tokenName: token.config.tokenName,
					currentPrice,
					previousPrice,
					change,
					changePercentage,
					threshold,
					timestamp: new Date(),
				};
				this.emit("alert", alert);
			}

			// Store price history in database
			database.addPriceHistory({
				tokenContract,
				tokenName: token.config.tokenName,
				price: currentPrice,
				timestamp: Date.now(),
			});

			// Update token state and database
			token.lastPrice = currentPrice;
			token.lastCheckTime = new Date();

			database.updateWatchedToken(tokenContract, {
				lastPrice: currentPrice,
				lastCheckTime: Date.now(),
			});
		} catch (error) {
			console.error(
				`Error checking price for ${token.config.tokenName}:`,
				error,
			);
			this.emit("error", error);
		}
	}

	private createPriceAlertMessage(
		tokenName: string,
		currentPrice: number,
		previousPrice: number,
		change: number,
		changePercentage: number,
		threshold: number,
	): string {
		const direction = change > 0 ? "📈" : "📉";
		const changeStr = change > 0 ? "+" : "";

		return (
			`${direction} ${tokenName} price alert!\n\n` +
			`💰 Current price: ${agentsApi.formatCurrency(currentPrice)}\n` +
			`📊 Previous price: ${agentsApi.formatCurrency(previousPrice)}\n` +
			`🔄 Change: ${changeStr}${agentsApi.formatCurrency(change)} (${changePercentage.toFixed(2)}%)\n` +
			`🚨 Threshold: ${threshold}%\n\n` +
			`${change > 0 ? "Price is going up! 🚀" : "Price is going down! 📉"}`
		);
	}

	getTrackedTokens(): Array<{
		tokenContract: string;
		tokenName: string;
		lastPrice: number;
		lastCheckTime: Date;
		config: TokenWatchConfig;
	}> {
		return Array.from(this.trackedTokens.entries()).map(
			([tokenContract, token]) => ({
				tokenContract,
				tokenName: token.config.tokenName,
				lastPrice: token.lastPrice,
				lastCheckTime: token.lastCheckTime,
				config: token.config,
			}),
		);
	}

	getTokenStatus(tokenContract: string): TrackedToken | null {
		return this.trackedTokens.get(tokenContract) || null;
	}

	updateTokenConfig(
		tokenContract: string,
		updates: Partial<TokenWatchConfig>,
	): void {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) {
			console.log(`💡 Token ${tokenContract} is not being tracked`);
			return;
		}

		token.config = { ...token.config, ...updates };

		// Update database
		database.updateWatchedToken(tokenContract, {
			tokenName: token.config.tokenName,
			minorThreshold: token.config.thresholds.minor,
			majorThreshold: token.config.thresholds.major,
			criticalThreshold: token.config.thresholds.critical,
			checkInterval: token.config.checkInterval,
			enableMinorAlerts: token.config.enableMinorAlerts,
			enableMajorAlerts: token.config.enableMajorAlerts,
			enableCriticalAlerts: token.config.enableCriticalAlerts,
		});

		console.log(
			`⚙️  Updated config for ${token.config.tokenName}:`,
			token.config,
		);

		if (this.isRunning && token.intervalId) {
			this.stopTrackingToken(tokenContract);
			this.startTrackingToken(tokenContract);
		}
	}

	updateTokenAlerts(
		tokenContract: string,
		alertConfig: {
			enableMinorAlerts?: boolean;
			enableMajorAlerts?: boolean;
			enableCriticalAlerts?: boolean;
		},
	): void {
		const token = this.trackedTokens.get(tokenContract);
		if (!token) {
			throw new Error(`Token ${tokenContract} is not being tracked`);
		}

		// Update in-memory configuration
		if (alertConfig.enableMinorAlerts !== undefined) {
			token.config.enableMinorAlerts = alertConfig.enableMinorAlerts;
		}
		if (alertConfig.enableMajorAlerts !== undefined) {
			token.config.enableMajorAlerts = alertConfig.enableMajorAlerts;
		}
		if (alertConfig.enableCriticalAlerts !== undefined) {
			token.config.enableCriticalAlerts = alertConfig.enableCriticalAlerts;
		}

		// Update database
		database.updateWatchedToken(tokenContract, {
			enableMinorAlerts: token.config.enableMinorAlerts,
			enableMajorAlerts: token.config.enableMajorAlerts,
			enableCriticalAlerts: token.config.enableCriticalAlerts,
		});

		console.log(
			`⚙️  Updated alert configuration for ${token.config.tokenName}:`,
			{
				enableMinorAlerts: token.config.enableMinorAlerts,
				enableMajorAlerts: token.config.enableMajorAlerts,
				enableCriticalAlerts: token.config.enableCriticalAlerts,
			},
		);
	}

	async getCurrentPrice(tokenContract: string): Promise<number> {
		const stats = await agentsApi.getAgentStats(tokenContract);
		return stats.currentPriceInUSD;
	}

	getStatus(): {
		isRunning: boolean;
		trackedTokensCount: number;
		trackedTokens: string[];
	} {
		return {
			isRunning: this.isRunning,
			trackedTokensCount: this.trackedTokens.size,
			trackedTokens: Array.from(this.trackedTokens.keys()),
		};
	}
}

export default PriceWatcher;
