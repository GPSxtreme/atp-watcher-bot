import { EventEmitter } from "node:events";
import { agentsApi } from "./agents";
import { database } from "./database";

export interface IQPriceAlert {
	type: "iq_price_increase" | "iq_price_decrease" | "iq_significant_change";
	severity: "low" | "medium" | "high" | "critical";
	message: string;
	currentPrice: number;
	previousPrice: number;
	change: number;
	changePercentage: number;
	threshold: number;
	timestamp: Date;
}

interface IQWatcherConfig {
	minorThreshold: number; // 1-5% changes
	majorThreshold: number; // 5-15% changes
	criticalThreshold: number; // 15%+ changes
	checkInterval: number;
	enableMinorAlerts: boolean;
	enableMajorAlerts: boolean;
	enableCriticalAlerts: boolean;
}

export class IQPriceWatcher extends EventEmitter {
	private config: IQWatcherConfig;
	private isRunning: boolean = false;
	private intervalId: NodeJS.Timeout | null = null;
	private lastKnownPrice: number = 0;
	private lastCheckTime: Date = new Date();

	constructor(config: Partial<IQWatcherConfig> = {}) {
		super();

		// Load preferences from database
		const dbMinorThreshold = database.getPreference("iq_minor_threshold");
		const dbMajorThreshold = database.getPreference("iq_major_threshold");
		const dbCriticalThreshold = database.getPreference("iq_critical_threshold");
		const dbCheckInterval = database.getPreference("iq_check_interval");

		this.config = {
			minorThreshold:
				config.minorThreshold ||
				(dbMinorThreshold ? parseFloat(dbMinorThreshold) : 2.0),
			majorThreshold:
				config.majorThreshold ||
				(dbMajorThreshold ? parseFloat(dbMajorThreshold) : 10.0),
			criticalThreshold:
				config.criticalThreshold ||
				(dbCriticalThreshold ? parseFloat(dbCriticalThreshold) : 20.0),
			checkInterval:
				config.checkInterval ||
				(dbCheckInterval ? parseInt(dbCheckInterval) : 60),
			enableMinorAlerts: config.enableMinorAlerts ?? true,
			enableMajorAlerts: config.enableMajorAlerts ?? true,
			enableCriticalAlerts: config.enableCriticalAlerts ?? true,
		};
	}

	async start(): Promise<void> {
		if (this.isRunning) {
			console.log("💡 IQ price watcher is already running");
			return;
		}

		console.log("🚀 Starting IQ token price monitoring");
		console.log(
			`📊 Thresholds - Minor: ${this.config.minorThreshold}%, Major: ${this.config.majorThreshold}%, Critical: ${this.config.criticalThreshold}%`,
		);
		console.log(`⏰ Check interval: ${this.config.checkInterval}s`);

		this.isRunning = true;
		await this.checkIQPrice();

		this.intervalId = setInterval(async () => {
			try {
				await this.checkIQPrice();
			} catch (error) {
				console.error("Error in IQ price check:", error);
				this.emit("error", error);
			}
		}, this.config.checkInterval * 1000);

		this.emit("started");
	}

	async stop(): Promise<void> {
		if (!this.isRunning) {
			console.log("💡 IQ price watcher is already stopped");
			return;
		}

		console.log("🛑 Stopping IQ token price monitoring");
		this.isRunning = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.emit("stopped");
	}

	private async checkIQPrice(): Promise<void> {
		try {
			const pricesData = await agentsApi.getPrices();
			const currentPrice = pricesData.everipedia.usd; // Use everipedia key for IQ token
			const previousPrice = this.lastKnownPrice;
			const now = new Date();

			console.log(
				`🪙 IQ Token Price: ${agentsApi.formatCurrency(currentPrice)}`,
			);

			if (previousPrice > 0) {
				const change = currentPrice - previousPrice;
				const changePercentage = agentsApi.calculatePercentageChange(
					previousPrice,
					currentPrice,
				);

				// Only send alerts if there's actually a price change
				if (Math.abs(changePercentage) === 0) {
					// No price change, skip alert
					return;
				}

				let alertType: IQPriceAlert["type"] = "iq_significant_change";
				let alertSeverity: IQPriceAlert["severity"] = "medium";
				let threshold = 0;
				let shouldAlert = false;

				// Determine alert type based on threshold exceeded
				if (Math.abs(changePercentage) >= this.config.criticalThreshold) {
					alertType = "iq_significant_change";
					alertSeverity = "critical";
					threshold = this.config.criticalThreshold;
					shouldAlert = this.config.enableCriticalAlerts;
				} else if (Math.abs(changePercentage) >= this.config.majorThreshold) {
					alertType = change > 0 ? "iq_price_increase" : "iq_price_decrease";
					alertSeverity = "high";
					threshold = this.config.majorThreshold;
					shouldAlert = this.config.enableMajorAlerts;
				} else if (Math.abs(changePercentage) >= this.config.minorThreshold) {
					alertType = change > 0 ? "iq_price_increase" : "iq_price_decrease";
					alertSeverity = "low";
					threshold = this.config.minorThreshold;
					shouldAlert = this.config.enableMinorAlerts;
				}

				// Only send alert if threshold is exceeded and alerts are enabled
				if (shouldAlert && threshold > 0) {
					const alert: IQPriceAlert = {
						type: alertType,
						severity: alertSeverity,
						message: this.createIQPriceAlertMessage(
							currentPrice,
							previousPrice,
							change,
							changePercentage,
							threshold,
							alertSeverity,
						),
						currentPrice,
						previousPrice,
						change,
						changePercentage,
						threshold,
						timestamp: now,
					};

					// Store alert in database
					database.addAlert({
						type: "iq_price",
						message: alert.message,
						timestamp: now.getTime(),
						triggered: false,
					});

					this.emit("alert", alert);
				}
			}

			// Store IQ price history in database
			database.addPriceHistory({
				tokenContract: "IQ_TOKEN",
				tokenName: "IQ (Everipedia)",
				price: currentPrice,
				timestamp: Date.now(),
			});

			this.lastKnownPrice = currentPrice;
			this.lastCheckTime = now;
		} catch (error) {
			console.error("Error checking IQ price:", error);
			this.emit("error", error);
		}
	}

	private createIQPriceAlertMessage(
		currentPrice: number,
		previousPrice: number,
		change: number,
		changePercentage: number,
		threshold: number,
		severity: IQPriceAlert["severity"],
	): string {
		const direction = change > 0 ? "📈" : "📉";
		const changeStr = change > 0 ? "+" : "";
		const severityEmoji = {
			low: "🔵",
			medium: "🟡",
			high: "🟠",
			critical: "🔴",
		}[severity];

		return (
			`${severityEmoji} ${direction} IQ Token Price Alert!\n\n` +
			`💰 Current price: ${agentsApi.formatCurrency(currentPrice)}\n` +
			`📊 Previous price: ${agentsApi.formatCurrency(previousPrice)}\n` +
			`🔄 Change: ${changeStr}${agentsApi.formatCurrency(change)} (${changePercentage.toFixed(2)}%)\n` +
			`🚨 Threshold: ${threshold}%\n\n` +
			`🪙 Since IQ is the base token, this may affect all agent prices!\n` +
			`${change > 0 ? "🚀 All agents may see price increases!" : "📉 All agents may see price decreases!"}`
		);
	}

	updateConfig(newConfig: Partial<IQWatcherConfig>): void {
		this.config = { ...this.config, ...newConfig };

		// Save preferences to database
		if (newConfig.minorThreshold !== undefined) {
			database.setPreference(
				"iq_minor_threshold",
				newConfig.minorThreshold.toString(),
			);
		}
		if (newConfig.majorThreshold !== undefined) {
			database.setPreference(
				"iq_major_threshold",
				newConfig.majorThreshold.toString(),
			);
		}
		if (newConfig.criticalThreshold !== undefined) {
			database.setPreference(
				"iq_critical_threshold",
				newConfig.criticalThreshold.toString(),
			);
		}
		if (newConfig.checkInterval !== undefined) {
			database.setPreference(
				"iq_check_interval",
				newConfig.checkInterval.toString(),
			);
		}

		console.log("⚙️  IQ price watcher config updated:", this.config);

		// Restart if running to apply new interval
		if (this.isRunning && newConfig.checkInterval !== undefined) {
			this.stop().then(() => this.start());
		}
	}

	async getCurrentIQPrice(): Promise<number> {
		const pricesData = await agentsApi.getPrices();
		return pricesData.everipedia.usd;
	}

	getStatus(): {
		isRunning: boolean;
		config: IQWatcherConfig;
		lastKnownPrice: number;
		lastCheckTime: Date;
	} {
		return {
			isRunning: this.isRunning,
			config: this.config,
			lastKnownPrice: this.lastKnownPrice,
			lastCheckTime: this.lastCheckTime,
		};
	}
}
