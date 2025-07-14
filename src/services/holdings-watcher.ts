import { EventEmitter } from "events";
import { env } from "../env";
import { agentsApi, type Holding, type HoldingsResponse } from "./agents";
import { database } from "./database";

export interface HoldingsAlert {
	type: "threshold_reached" | "significant_change";
	message: string;
	totalValue: number;
	previousValue?: number;
	change?: number;
	changePercentage?: number;
	holdings: Holding[];
	timestamp: Date;
}

interface WatcherConfig {
	address: string;
	thresholdUsd: number;
	checkInterval: number;
	significantChangePercentage: number;
}

export class HoldingsWatcher extends EventEmitter {
	private config: WatcherConfig;
	private isRunning: boolean = false;
	private intervalId: NodeJS.Timeout | null = null;
	private lastKnownValue: number = 0;
	private lastCheckTime: Date = new Date();
	private thresholdReached: boolean = false;

	constructor(config: Partial<WatcherConfig> = {}) {
		super();

		// Load preferences from database
		const dbThreshold = database.getPreference("holdings_threshold");
		const dbCheckInterval = database.getPreference("holdings_check_interval");
		const dbChangePercentage = database.getPreference("price_change_threshold");

		this.config = {
			address: config.address || env.WALLET_ADDRESS,
			thresholdUsd:
				config.thresholdUsd ||
				(dbThreshold
					? parseFloat(dbThreshold)
					: env.DEFAULT_HOLDINGS_THRESHOLD),
			checkInterval:
				config.checkInterval ||
				(dbCheckInterval
					? parseInt(dbCheckInterval)
					: env.HOLDINGS_CHECK_INTERVAL),
			significantChangePercentage:
				config.significantChangePercentage ||
				(dbChangePercentage
					? parseFloat(dbChangePercentage)
					: env.DEFAULT_PRICE_CHANGE_THRESHOLD),
		};
	}

	async start(): Promise<void> {
		if (this.isRunning) {
			console.log("💡 Holdings watcher is already running");
			return;
		}

		console.log(`🚀 Starting holdings watcher for ${this.config.address}`);
		console.log(
			`📊 Threshold: ${agentsApi.formatCurrency(this.config.thresholdUsd)}`,
		);
		console.log(`⏰ Check interval: ${this.config.checkInterval}s`);

		this.isRunning = true;
		await this.checkHoldings();

		this.intervalId = setInterval(async () => {
			try {
				await this.checkHoldings();
			} catch (error) {
				console.error("Error in holdings check:", error);
				this.emit("error", error);
			}
		}, this.config.checkInterval * 1000);

		this.emit("started");
	}

	async stop(): Promise<void> {
		if (!this.isRunning) {
			console.log("💡 Holdings watcher is already stopped");
			return;
		}

		console.log("🛑 Stopping holdings watcher");
		this.isRunning = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.emit("stopped");
	}

	private async checkHoldings(): Promise<void> {
		try {
			const holdingsData: HoldingsResponse = await agentsApi.getHoldings(
				this.config.address,
			);
			const currentValue = agentsApi.calculateHoldingsValue(
				holdingsData.holdings,
			);
			const now = new Date();

			console.log(
				`📊 Current holdings value: ${agentsApi.formatCurrency(currentValue)}`,
			);

			if (this.lastKnownValue > 0) {
				const change = currentValue - this.lastKnownValue;
				const changePercentage = agentsApi.calculatePercentageChange(
					this.lastKnownValue,
					currentValue,
				);

				// Only send alerts if there's actually a portfolio value change
				if (
					Math.abs(changePercentage) > 0 &&
					Math.abs(changePercentage) >= this.config.significantChangePercentage
				) {
					const alert: HoldingsAlert = {
						type: "significant_change",
						message: this.createChangeMessage(
							currentValue,
							this.lastKnownValue,
							change,
							changePercentage,
						),
						totalValue: currentValue,
						previousValue: this.lastKnownValue,
						change,
						changePercentage,
						holdings: holdingsData.holdings,
						timestamp: now,
					};

					// Store alert in database
					database.addAlert({
						type: "holdings",
						message: alert.message,
						timestamp: now.getTime(),
						triggered: false,
					});

					this.emit("alert", alert);
				}
			}

			if (currentValue >= this.config.thresholdUsd && !this.thresholdReached) {
				this.thresholdReached = true;
				const alert: HoldingsAlert = {
					type: "threshold_reached",
					message: this.createThresholdMessage(
						currentValue,
						this.config.thresholdUsd,
					),
					totalValue: currentValue,
					holdings: holdingsData.holdings,
					timestamp: now,
				};

				// Store alert in database
				database.addAlert({
					type: "holdings",
					message: alert.message,
					timestamp: now.getTime(),
					triggered: false,
				});

				this.emit("alert", alert);
			} else if (
				currentValue < this.config.thresholdUsd &&
				this.thresholdReached
			) {
				this.thresholdReached = false;
			}

			this.lastKnownValue = currentValue;
			this.lastCheckTime = now;
		} catch (error) {
			console.error("Error checking holdings:", error);
			this.emit("error", error);
		}
	}

	private createThresholdMessage(
		currentValue: number,
		threshold: number,
	): string {
		return `🎯 Holdings threshold reached!\n\n💰 Current value: ${agentsApi.formatCurrency(currentValue)}\n🎯 Threshold: ${agentsApi.formatCurrency(threshold)}\n\nConsider reviewing your positions!`;
	}

	private createChangeMessage(
		currentValue: number,
		previousValue: number,
		change: number,
		changePercentage: number,
	): string {
		const direction = change > 0 ? "📈" : "📉";
		const changeStr = change > 0 ? "+" : "";

		return `${direction} Significant portfolio change detected!\n\n💰 Current value: ${agentsApi.formatCurrency(currentValue)}\n📊 Previous value: ${agentsApi.formatCurrency(previousValue)}\n🔄 Change: ${changeStr}${agentsApi.formatCurrency(change)} (${changePercentage.toFixed(2)}%)\n\nTime to review your positions!`;
	}

	getStatus(): {
		isRunning: boolean;
		config: WatcherConfig;
		lastKnownValue: number;
		lastCheckTime: Date;
		thresholdReached: boolean;
	} {
		return {
			isRunning: this.isRunning,
			config: this.config,
			lastKnownValue: this.lastKnownValue,
			lastCheckTime: this.lastCheckTime,
			thresholdReached: this.thresholdReached,
		};
	}

	updateConfig(newConfig: Partial<WatcherConfig>): void {
		this.config = { ...this.config, ...newConfig };

		// Save preferences to database
		if (newConfig.thresholdUsd !== undefined) {
			database.setPreference(
				"holdings_threshold",
				newConfig.thresholdUsd.toString(),
			);
		}
		if (newConfig.checkInterval !== undefined) {
			database.setPreference(
				"holdings_check_interval",
				newConfig.checkInterval.toString(),
			);
		}
		if (newConfig.significantChangePercentage !== undefined) {
			database.setPreference(
				"price_change_threshold",
				newConfig.significantChangePercentage.toString(),
			);
		}

		console.log("⚙️  Holdings watcher config updated:", this.config);
	}

	async getCurrentHoldings(): Promise<{ value: number; holdings: Holding[] }> {
		const holdingsData = await agentsApi.getHoldings(this.config.address);
		const value = agentsApi.calculateHoldingsValue(holdingsData.holdings);
		return { value, holdings: holdingsData.holdings };
	}
}

export default HoldingsWatcher;
