import dedent from "dedent";
import { type Context, Markup, Telegraf } from "telegraf";
import { env } from "./env";
import { agentsApi } from "./services/agents";
import { database } from "./services/database";
import {
	type HoldingsAlert,
	HoldingsWatcher,
} from "./services/holdings-watcher";
import { type IQPriceAlert, IQPriceWatcher } from "./services/iq-price-watcher";
import { type PriceAlert, PriceWatcher } from "./services/price-watcher";

interface BotContext extends Context {
	// Add any custom context properties here
}

class IQAgentsTelegramBot {
	private bot: Telegraf<BotContext>;
	private holdingsWatcher: HoldingsWatcher;
	private priceWatcher: PriceWatcher;
	private iqPriceWatcher: IQPriceWatcher;

	constructor() {
		this.bot = new Telegraf<BotContext>(env.TELEGRAM_BOT_TOKEN);
		this.holdingsWatcher = new HoldingsWatcher();
		this.priceWatcher = new PriceWatcher();
		this.iqPriceWatcher = new IQPriceWatcher();

		this.setupCommands();
		this.setupWatchers();
	}

	private setupCommands(): void {
		// Start command
		this.bot.command("start", (ctx) => {
			ctx.reply(
				dedent`
					🤖 *Welcome to IQ Agents Watcher!*

					I'll help you monitor your IQ Agent investments and get notified about important changes.

					Use /help to see all available commands.
				`,
				{
					parse_mode: "Markdown",
					...Markup.inlineKeyboard([
						[Markup.button.callback("📊 Portfolio Status", "portfolio_status")],
						[Markup.button.callback("⚙️ Settings", "settings")],
						[Markup.button.callback("📈 Top Agents", "top_agents")],
					]),
				},
			);
		});

		// Help command with menu
		this.bot.command("help", (ctx) => {
			ctx.reply(
				dedent`
					🤖 *IQ Agents Watcher Bot - Help Menu*

					Welcome! I'll help you monitor your IQ Agent investments and get notified about important changes.

					Choose a category below to learn more:
				`,
				{
					parse_mode: "Markdown",
					...Markup.inlineKeyboard([
						[
							Markup.button.callback(
								"📊 Portfolio & Holdings",
								"help_portfolio",
							),
						],
						[Markup.button.callback("📈 Price Monitoring", "help_price")],
						[Markup.button.callback("🔍 Token Research", "help_research")],
						[Markup.button.callback("🪙 IQ Token Monitoring", "help_iq")],
						[Markup.button.callback("⚙️ System & Config", "help_system")],
						[
							Markup.button.callback(
								"💡 Getting Started",
								"help_getting_started",
							),
						],
					]),
				},
			);
		});

		// Portfolio command
		this.bot.command("portfolio", async (ctx) => {
			try {
				const loading = await ctx.reply("📊 Loading your portfolio...");
				const { value, holdings } =
					await this.holdingsWatcher.getCurrentHoldings();

				if (holdings.length === 0) {
					await ctx.telegram.editMessageText(
						ctx.chat?.id,
						loading.message_id,
						undefined,
						"📊 No holdings found for your wallet address.",
					);
					return;
				}

				let message = "💰 *Your Portfolio*\n\n";
				message += `💵 Total Value: *${agentsApi.formatCurrency(value)}*\n\n`;
				message += "📊 Holdings:\n";

				holdings.forEach((holding, index) => {
					const tokenValue =
						parseFloat(holding.tokenAmount) * holding.currentPriceInUsd;
					message += `${index + 1}. *${holding.name}*\n`;
					message += `   📊 Amount: ${agentsApi.formatTokenAmount(holding.tokenAmount)}\n`;
					message += `   💰 Price: ${agentsApi.formatCurrency(holding.currentPriceInUsd)}\n`;
					message += `   💵 Value: ${agentsApi.formatCurrency(tokenValue)}\n\n`;
				});

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching portfolio:", error);
				ctx.reply("❌ Error fetching portfolio. Please try again.");
			}
		});

		// Set threshold command
		this.bot.command("set_threshold", (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply(
					"❌ Usage: /set_threshold <amount>\nExample: /set_threshold 1000",
				);
				return;
			}

			const threshold = parseFloat(args[1]!);
			if (Number.isNaN(threshold) || threshold <= 0) {
				ctx.reply("❌ Please provide a valid threshold amount.");
				return;
			}

			this.holdingsWatcher.updateConfig({ thresholdUsd: threshold });
			ctx.reply(
				`✅ Holdings threshold set to ${agentsApi.formatCurrency(threshold)}`,
			);
		});

		// Set percentage threshold command
		this.bot.command("set_change_threshold", (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply(
					"❌ Usage: /set_change_threshold <percentage>\nExample: /set_change_threshold 10",
				);
				return;
			}

			const percentage = parseFloat(args[1]!);
			if (Number.isNaN(percentage) || percentage <= 0 || percentage > 100) {
				ctx.reply("❌ Please provide a valid percentage between 0-100.");
				return;
			}

			this.holdingsWatcher.updateConfig({
				significantChangePercentage: percentage,
			});
			ctx.reply(`✅ Portfolio change threshold set to ${percentage}%`);
		});

		// Set monitoring interval command
		this.bot.command("set_interval", (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply(
					"❌ Usage: /set_interval <seconds>\nExample: /set_interval 300 (5 minutes)",
				);
				return;
			}

			const interval = parseInt(args[1]!);
			if (Number.isNaN(interval) || interval < 30 || interval > 3600) {
				ctx.reply(
					"❌ Please provide a valid interval between 30-3600 seconds (30s - 1h).",
				);
				return;
			}

			this.holdingsWatcher.updateConfig({ checkInterval: interval });
			const minutes = Math.floor(interval / 60);
			const seconds = interval % 60;
			const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
			ctx.reply(`✅ Holdings monitoring interval set to ${timeStr}`);
		});

		// Enhanced settings command with all configuration options
		this.bot.command("config", (ctx) => {
			const holdingsStatus = this.holdingsWatcher.getStatus();
			const priceStatus = this.priceWatcher.getStatus();
			const iqStatus = this.iqPriceWatcher.getStatus();
			const trackedTokens = this.priceWatcher.getTrackedTokens();

			let message = "⚙️ *Current Configuration:*\n\n";

			message += "*Holdings Monitoring:*\n";
			message += `💰 USD Threshold: ${agentsApi.formatCurrency(holdingsStatus.config.thresholdUsd)}\n`;
			message += `📊 Change Threshold: ${holdingsStatus.config.significantChangePercentage}%\n`;
			message += `⏰ Check Interval: ${holdingsStatus.config.checkInterval}s\n`;
			message += `🔄 Status: ${holdingsStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n\n`;

			message += "*Price Monitoring:*\n";
			message += `👁️ Tracked Tokens: ${priceStatus.trackedTokensCount}\n`;
			message += `🔄 Status: ${priceStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n\n`;

			message += "*IQ Token Monitoring:*\n";
			message += `📊 Minor: ${iqStatus.config.minorThreshold}%, Major: ${iqStatus.config.majorThreshold}%, Critical: ${iqStatus.config.criticalThreshold}%\n`;
			message += `⏰ Check Interval: ${iqStatus.config.checkInterval}s\n`;
			message += `🔔 Alerts: ${
				[
					iqStatus.config.enableMinorAlerts ? "Minor" : "",
					iqStatus.config.enableMajorAlerts ? "Major" : "",
					iqStatus.config.enableCriticalAlerts ? "Critical" : "",
				]
					.filter(Boolean)
					.join(", ") || "None"
			}\n`;
			message += `🔄 Status: ${iqStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n\n`;

			if (trackedTokens.length > 0) {
				message += "*Tracked Tokens Configuration:*\n";
				trackedTokens.slice(0, 5).forEach((token, index) => {
					message += `${index + 1}. *${token.tokenName}*\n`;
					message += `   📊 Minor: ${token.config.thresholds.minor}%, Major: ${token.config.thresholds.major}%, Critical: ${token.config.thresholds.critical}%\n`;
					message += `   🔔 Alerts: ${
						[
							token.config.enableMinorAlerts ? "Minor" : "",
							token.config.enableMajorAlerts ? "Major" : "",
							token.config.enableCriticalAlerts ? "Critical" : "",
						]
							.filter(Boolean)
							.join(", ") || "None"
					}\n`;
					message += `   ⏰ Interval: ${token.config.checkInterval}s\n\n`;
				});
				if (trackedTokens.length > 5) {
					message += `   ... and ${trackedTokens.length - 5} more tokens\n\n`;
				}
			}

			message += "*Configuration Commands:*\n";
			message += `💰 /set_threshold <amount> - Set USD threshold\n`;
			message += `📊 /set_change_threshold <percentage> - Set change threshold\n`;
			message += `⏰ /set_interval <seconds> - Set monitoring interval\n`;
			message += `🎯 /watch_config <address> <threshold> [interval] - Configure token watching\n`;
			message += `🔧 /watch_advanced <address> <minor%> <major%> <critical%> [interval] - Advanced token configuration\n`;
			message += `🔔 /alert_config <address> <minor:on/off> <major:on/off> <critical:on/off> - Configure alert types\n`;
			message += `🪙 /iq_config <minor%> <major%> <critical%> [interval] - Configure IQ monitoring\n`;
			message += `🔔 /iq_alerts <minor:on/off> <major:on/off> <critical:on/off> - Configure IQ alerts\n`;

			ctx.reply(message, { parse_mode: "Markdown" });
		});

		// Enhanced watch command with configuration options
		this.bot.command("watch_config", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 3) {
				ctx.reply(
					"❌ Usage: /watch_config <token_address> <threshold_percentage> [interval_seconds]\nExample: /watch_config 0x... 5 60",
				);
				return;
			}

			const tokenAddress = args[1]!;
			const threshold = parseFloat(args[2]!);
			const interval = args[3] ? parseInt(args[3]) : 60;

			if (Number.isNaN(threshold) || threshold <= 0 || threshold > 100) {
				ctx.reply(
					"❌ Please provide a valid threshold percentage between 0-100.",
				);
				return;
			}

			if (Number.isNaN(interval) || interval < 30 || interval > 3600) {
				ctx.reply(
					"❌ Please provide a valid interval between 30-3600 seconds.",
				);
				return;
			}

			try {
				const loading = await ctx.reply("🔄 Configuring token monitoring...");
				const agentInfo = await agentsApi.getAgentInfo(tokenAddress);

				// Add with custom configuration
				await this.priceWatcher.addToken(
					tokenAddress,
					agentInfo.name,
					threshold,
					interval,
				);

				const timeStr =
					interval >= 60 ? `${Math.floor(interval / 60)}m` : `${interval}s`;
				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					`✅ Configured monitoring for ${agentInfo.name} (${agentInfo.ticker})\n📊 Threshold: ${threshold}%\n⏰ Interval: ${timeStr}`,
				);
			} catch (error) {
				console.error("Error configuring token monitoring:", error);
				ctx.reply(
					"❌ Error configuring token monitoring. Please check the address.",
				);
			}
		});

		// Advanced token configuration with modular thresholds
		this.bot.command("watch_advanced", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 5) {
				ctx.reply(
					"❌ Usage: /watch_advanced <token_address> <minor%> <major%> <critical%> [interval_seconds]\nExample: /watch_advanced 0x... 2 10 20 60",
				);
				return;
			}

			const tokenAddress = args[1]!;
			const minorThreshold = parseFloat(args[2]!);
			const majorThreshold = parseFloat(args[3]!);
			const criticalThreshold = parseFloat(args[4]!);
			const interval = args[5] ? parseInt(args[5]) : 60;

			if (
				Number.isNaN(minorThreshold) ||
				minorThreshold <= 0 ||
				minorThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid minor threshold percentage between 0-100.",
				);
				return;
			}

			if (
				Number.isNaN(majorThreshold) ||
				majorThreshold <= minorThreshold ||
				majorThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid major threshold percentage greater than minor threshold.",
				);
				return;
			}

			if (
				Number.isNaN(criticalThreshold) ||
				criticalThreshold <= majorThreshold ||
				criticalThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid critical threshold percentage greater than major threshold.",
				);
				return;
			}

			if (Number.isNaN(interval) || interval < 30 || interval > 3600) {
				ctx.reply(
					"❌ Please provide a valid interval between 30-3600 seconds.",
				);
				return;
			}

			try {
				const loading = await ctx.reply(
					"🔄 Configuring advanced token monitoring...",
				);
				const agentInfo = await agentsApi.getAgentInfo(tokenAddress);

				// Add with advanced configuration
				await this.priceWatcher.addTokenAdvanced(
					tokenAddress,
					agentInfo.name,
					{
						minor: minorThreshold,
						major: majorThreshold,
						critical: criticalThreshold,
					},
					interval,
				);

				const timeStr =
					interval >= 60 ? `${Math.floor(interval / 60)}m` : `${interval}s`;
				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					`✅ Advanced monitoring configured for ${agentInfo.name} (${agentInfo.ticker})\n📊 Minor: ${minorThreshold}%, Major: ${majorThreshold}%, Critical: ${criticalThreshold}%\n⏰ Interval: ${timeStr}`,
				);
			} catch (error) {
				console.error("Error configuring advanced token monitoring:", error);
				ctx.reply(
					"❌ Error configuring advanced token monitoring. Please check the address.",
				);
			}
		});

		// Configure alert types for a token
		this.bot.command("alert_config", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 5) {
				ctx.reply(
					"❌ Usage: /alert_config <token_address> <minor:on/off> <major:on/off> <critical:on/off>\nExample: /alert_config 0x... on off on",
				);
				return;
			}

			const tokenAddress = args[1]!;
			const minorEnabled = args[2]!.toLowerCase() === "on";
			const majorEnabled = args[3]!.toLowerCase() === "on";
			const criticalEnabled = args[4]!.toLowerCase() === "on";

			try {
				this.priceWatcher.updateTokenAlerts(tokenAddress, {
					enableMinorAlerts: minorEnabled,
					enableMajorAlerts: majorEnabled,
					enableCriticalAlerts: criticalEnabled,
				});

				const enabledAlerts: string[] = [];
				if (minorEnabled) enabledAlerts.push("Minor");
				if (majorEnabled) enabledAlerts.push("Major");
				if (criticalEnabled) enabledAlerts.push("Critical");

				ctx.reply(
					`✅ Alert configuration updated!\n📊 Enabled: ${enabledAlerts.join(", ") || "None"}\n🔇 Disabled: ${["Minor", "Major", "Critical"].filter((type) => !enabledAlerts.includes(type)).join(", ") || "None"}`,
				);
			} catch (error) {
				console.error("Error configuring alerts:", error);
				ctx.reply(
					"❌ Error configuring alerts. Please check the token address.",
				);
			}
		});

		// IQ price monitoring commands
		this.bot.command("start_iq", async (ctx) => {
			try {
				await this.iqPriceWatcher.start();
				ctx.reply("✅ IQ token price monitoring started!");
			} catch (error) {
				console.error("Error starting IQ price watcher:", error);
				ctx.reply("❌ Error starting IQ price monitoring.");
			}
		});

		this.bot.command("stop_iq", async (ctx) => {
			try {
				await this.iqPriceWatcher.stop();
				ctx.reply("⏹️ IQ token price monitoring stopped!");
			} catch (error) {
				console.error("Error stopping IQ price watcher:", error);
				ctx.reply("❌ Error stopping IQ price monitoring.");
			}
		});

		// Configure IQ price thresholds
		this.bot.command("iq_config", (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 4) {
				ctx.reply(
					"❌ Usage: /iq_config <minor%> <major%> <critical%> [interval_seconds]\nExample: /iq_config 2 10 20 60",
				);
				return;
			}

			const minorThreshold = parseFloat(args[1]!);
			const majorThreshold = parseFloat(args[2]!);
			const criticalThreshold = parseFloat(args[3]!);
			const interval = args[4] ? parseInt(args[4]) : undefined;

			if (
				Number.isNaN(minorThreshold) ||
				minorThreshold <= 0 ||
				minorThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid minor threshold percentage between 0-100.",
				);
				return;
			}

			if (
				Number.isNaN(majorThreshold) ||
				majorThreshold <= minorThreshold ||
				majorThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid major threshold percentage greater than minor threshold.",
				);
				return;
			}

			if (
				Number.isNaN(criticalThreshold) ||
				criticalThreshold <= majorThreshold ||
				criticalThreshold > 100
			) {
				ctx.reply(
					"❌ Please provide a valid critical threshold percentage greater than major threshold.",
				);
				return;
			}

			if (
				interval &&
				(Number.isNaN(interval) || interval < 30 || interval > 3600)
			) {
				ctx.reply(
					"❌ Please provide a valid interval between 30-3600 seconds.",
				);
				return;
			}

			const config: any = {
				minorThreshold,
				majorThreshold,
				criticalThreshold,
			};

			if (interval) {
				config.checkInterval = interval;
			}

			this.iqPriceWatcher.updateConfig(config);

			const timeStr = interval
				? interval >= 60
					? `${Math.floor(interval / 60)}m`
					: `${interval}s`
				: "unchanged";
			ctx.reply(
				`✅ IQ price monitoring configured!\n📊 Minor: ${minorThreshold}%, Major: ${majorThreshold}%, Critical: ${criticalThreshold}%\n⏰ Interval: ${timeStr}`,
			);
		});

		// Configure IQ price alerts
		this.bot.command("iq_alerts", (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 4) {
				ctx.reply(
					"❌ Usage: /iq_alerts <minor:on/off> <major:on/off> <critical:on/off>\nExample: /iq_alerts on off on",
				);
				return;
			}

			const minorEnabled = args[1]!.toLowerCase() === "on";
			const majorEnabled = args[2]!.toLowerCase() === "on";
			const criticalEnabled = args[3]!.toLowerCase() === "on";

			this.iqPriceWatcher.updateConfig({
				enableMinorAlerts: minorEnabled,
				enableMajorAlerts: majorEnabled,
				enableCriticalAlerts: criticalEnabled,
			});

			const enabledAlerts: string[] = [];
			if (minorEnabled) enabledAlerts.push("Minor");
			if (majorEnabled) enabledAlerts.push("Major");
			if (criticalEnabled) enabledAlerts.push("Critical");

			ctx.reply(
				`✅ IQ price alerts configured!\n📊 Enabled: ${enabledAlerts.join(", ") || "None"}\n🔇 Disabled: ${["Minor", "Major", "Critical"].filter((type) => !enabledAlerts.includes(type)).join(", ") || "None"}`,
			);
		});

		// IQ price status
		this.bot.command("iq_status", (ctx) => {
			const iqStatus = this.iqPriceWatcher.getStatus();

			let message = "🪙 *IQ Token Price Monitoring Status:*\n\n";
			message += `🔄 Status: ${iqStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n`;
			message += `💰 Last Price: ${iqStatus.lastKnownPrice > 0 ? agentsApi.formatCurrency(iqStatus.lastKnownPrice) : "Unknown"}\n`;
			message += `⏰ Last Check: ${iqStatus.lastCheckTime.toLocaleString()}\n\n`;

			message += `*Thresholds:*\n`;
			message += `📊 Minor: ${iqStatus.config.minorThreshold}%\n`;
			message += `📊 Major: ${iqStatus.config.majorThreshold}%\n`;
			message += `📊 Critical: ${iqStatus.config.criticalThreshold}%\n`;
			message += `⏰ Interval: ${iqStatus.config.checkInterval}s\n\n`;

			message += `*Alerts:*\n`;
			message += `🔔 Minor: ${iqStatus.config.enableMinorAlerts ? "✅ Enabled" : "❌ Disabled"}\n`;
			message += `🔔 Major: ${iqStatus.config.enableMajorAlerts ? "✅ Enabled" : "❌ Disabled"}\n`;
			message += `🔔 Critical: ${iqStatus.config.enableCriticalAlerts ? "✅ Enabled" : "❌ Disabled"}\n\n`;

			message += `*Available Commands:*\n`;
			message += `▶️ /start_iq - Start IQ price monitoring\n`;
			message += `⏹️ /stop_iq - Stop IQ price monitoring\n`;
			message += `⚙️ /iq_config <minor%> <major%> <critical%> [interval] - Configure thresholds\n`;
			message += `🔔 /iq_alerts <minor:on/off> <major:on/off> <critical:on/off> - Configure alerts\n`;

			ctx.reply(message, { parse_mode: "Markdown" });
		});

		// Holdings monitoring commands
		this.bot.command("start_holdings", async (ctx) => {
			try {
				await this.holdingsWatcher.start();
				ctx.reply("✅ Holdings monitoring started!");
			} catch (error) {
				console.error("Error starting holdings watcher:", error);
				ctx.reply("❌ Error starting holdings monitoring.");
			}
		});

		this.bot.command("stop_holdings", async (ctx) => {
			try {
				await this.holdingsWatcher.stop();
				ctx.reply("⏹️ Holdings monitoring stopped!");
			} catch (error) {
				console.error("Error stopping holdings watcher:", error);
				ctx.reply("❌ Error stopping holdings monitoring.");
			}
		});

		// Watch token command
		this.bot.command("watch", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply(
					"❌ Usage: /watch <token_address>\nExample: /watch 0x4dBcC239b265295500D2Fe2d0900629BDcBBD0fB",
				);
				return;
			}

			const tokenAddress = args[1]!;
			try {
				const loading = await ctx.reply("🔄 Adding token to watch list...");
				const agentInfo = await agentsApi.getAgentInfo(tokenAddress);
				await this.priceWatcher.addToken(tokenAddress, agentInfo.name);

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					`✅ Now watching ${agentInfo.name} (${agentInfo.ticker})`,
				);
			} catch (error) {
				console.error("Error adding token to watch list:", error);
				ctx.reply(
					"❌ Error adding token to watch list. Please check the address.",
				);
			}
		});

		// Unwatch token command
		this.bot.command("unwatch", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply("❌ Usage: /unwatch <token_address>");
				return;
			}

			const tokenAddress = args[1]!;
			try {
				await this.priceWatcher.removeToken(tokenAddress);
				ctx.reply("✅ Token removed from watch list");
			} catch (error) {
				console.error("Error removing token from watch list:", error);
				ctx.reply("❌ Error removing token from watch list.");
			}
		});

		// List watched tokens
		this.bot.command("watched", (ctx) => {
			const trackedTokens = this.priceWatcher.getTrackedTokens();
			if (trackedTokens.length === 0) {
				ctx.reply("📊 No tokens are currently being watched.");
				return;
			}

			let message = "👁️ *Watched Tokens:*\n\n";
			trackedTokens.forEach((token, index) => {
				message += `${index + 1}. *${token.tokenName}*\n`;
				message += `   📊 Last Price: ${agentsApi.formatCurrency(token.lastPrice)}\n`;
				message += `   ⏰ Last Check: ${token.lastCheckTime.toLocaleString()}\n\n`;
			});

			ctx.reply(message, { parse_mode: "Markdown" });
		});

		// Price monitoring commands
		this.bot.command("start_price", async (ctx) => {
			try {
				await this.priceWatcher.start();
				ctx.reply("✅ Price monitoring started!");
			} catch (error) {
				console.error("Error starting price watcher:", error);
				ctx.reply("❌ Error starting price monitoring.");
			}
		});

		this.bot.command("stop_price", async (ctx) => {
			try {
				await this.priceWatcher.stop();
				ctx.reply("⏹️ Price monitoring stopped!");
			} catch (error) {
				console.error("Error stopping price watcher:", error);
				ctx.reply("❌ Error stopping price monitoring.");
			}
		});

		// Top agents command with sorting options
		this.bot.command("top", async (ctx) => {
			try {
				const args = ctx.message.text.split(" ");
				const sortBy = (args[1] as "mcap" | "holders" | "inferences") || "mcap";
				const limit = args[2] ? parseInt(args[2], 10) : 10;

				// Validate sorting parameter
				if (!["mcap", "holders", "inferences"].includes(sortBy)) {
					ctx.reply(
						"❌ Invalid sort parameter. Use: mcap, holders, or inferences",
					);
					return;
				}

				// Validate limit parameter
				if (limit < 1 || limit > 100) {
					ctx.reply("❌ Limit must be between 1 and 100");
					return;
				}

				const loading = await ctx.reply("📈 Loading top agents...");
				const topAgents = await agentsApi.getTopAgents(sortBy, limit);

				const sortLabels = {
					mcap: "Market Cap",
					holders: "Holders",
					inferences: "Inferences",
				};

				let message = `📈 *Top ${limit} Agents by ${sortLabels[sortBy]}:*\n\n`;
				topAgents.agents.forEach((agent, index) => {
					message += `${index + 1}. *${agent.name}* (${agent.ticker})\n`;
					message += `   💰 Price: ${agentsApi.formatCurrency(agent.currentPriceInUSD)}\n`;
					message += `   👥 Holders: ${agent.holdersCount}\n`;
					message += `   🧠 Inferences: ${agent.inferenceCount}\n`;
					message += `   📄 Contract: \`${agent.tokenContract}\`\n\n`;
				});

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching top agents:", error);
				ctx.reply("❌ Error fetching top agents.");
			}
		});

		// IQ price command
		this.bot.command("iq_price", async (ctx) => {
			try {
				const loading = await ctx.reply("🪙 Loading IQ token price...");
				const pricesData = await agentsApi.getPrices();
				const iqPrice = pricesData.everipedia.usd;

				const message = dedent`
					🪙 *IQ Token Price*

					💰 Current Price: *${agentsApi.formatCurrency(iqPrice)}*
					📊 Symbol: *IQ (Everipedia)*
					🕐 Updated: ${new Date().toLocaleString()}
				`;

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching IQ price:", error);
				ctx.reply("❌ Error fetching IQ token price.");
			}
		});

		// Agent stats command
		this.bot.command("stats", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply("❌ Usage: /stats <token_address>");
				return;
			}

			const tokenAddress = args[1]!;
			try {
				const loading = await ctx.reply("📊 Loading agent stats...");
				const agentStats = await agentsApi.getAgentStats(tokenAddress);

				const message = dedent`
					📊 *Agent Statistics*

					💰 Price in USD: *${agentsApi.formatCurrency(agentStats.currentPriceInUSD)}*
					🪙 Price in IQ: *${agentStats.currentPriceInIq}*
					📈 Market Cap: *${agentsApi.formatCurrency(agentStats.marketCap)}*
					📊 24h Change: *${agentStats.changeIn24h.toFixed(2)}%*
					👥 Holders: *${agentStats.holdersCount}*
					🧠 Inferences: *${agentStats.inferenceCount}*
					📂 Category: *${agentStats.category}*
				`;

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching agent stats:", error);
				ctx.reply("❌ Error fetching agent statistics.");
			}
		});

		// Price command
		this.bot.command("price", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply("❌ Usage: /price <token_address>");
				return;
			}

			const tokenAddress = args[1]!;
			try {
				const loading = await ctx.reply("💰 Loading current price...");
				const currentPrice =
					await this.priceWatcher.getCurrentPrice(tokenAddress);

				const message = dedent`
					💰 *Current Price*

					📊 Price: *${agentsApi.formatCurrency(currentPrice)}*
					🕐 Updated: ${new Date().toLocaleString()}
				`;

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching current price:", error);
				ctx.reply("❌ Error fetching current price.");
			}
		});

		// Agent info command
		this.bot.command("info", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply("❌ Usage: /info <token_address>");
				return;
			}

			const tokenAddress = args[1]!;
			try {
				const loading = await ctx.reply("ℹ️ Loading agent info...");
				const agentInfo = await agentsApi.getAgentInfo(tokenAddress);

				let message = `ℹ️ *${agentInfo.name}* (${agentInfo.ticker})\n\n`;
				message += `📊 Category: ${agentInfo.category}\n`;
				message += `👥 Holders: ${agentInfo.holdersCount}\n`;
				message += `🧠 Inferences: ${agentInfo.inferenceCount}\n`;
				message += `💰 Price in IQ: ${agentInfo.currentPriceInIq}\n`;
				message += `📅 Created: ${new Date(agentInfo.createdAt).toLocaleDateString()}\n\n`;
				message += `📝 Bio: ${agentInfo.bio.slice(0, 500)}${agentInfo.bio.length > 500 ? "..." : ""}`;

				await ctx.telegram.editMessageText(
					ctx.chat?.id,
					loading.message_id,
					undefined,
					message,
					{ parse_mode: "Markdown" },
				);
			} catch (error) {
				console.error("Error fetching agent info:", error);
				ctx.reply("❌ Error fetching agent info.");
			}
		});

		// Status command
		this.bot.command("status", (ctx) => {
			const holdingsStatus = this.holdingsWatcher.getStatus();
			const priceStatus = this.priceWatcher.getStatus();
			const iqStatus = this.iqPriceWatcher.getStatus();
			const dbStats = database.getStats();

			let message = "📊 *System Status:*\n\n";
			message += `💰 Holdings Watcher: ${holdingsStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n`;
			message += `📈 Price Watcher: ${priceStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n`;
			message += `🪙 IQ Price Watcher: ${iqStatus.isRunning ? "✅ Running" : "⏹️ Stopped"}\n`;
			message += `👁️ Tracked Tokens: ${priceStatus.trackedTokensCount}\n\n`;

			if (holdingsStatus.isRunning) {
				message += `🎯 Holdings Threshold: ${agentsApi.formatCurrency(holdingsStatus.config.thresholdUsd)}\n`;
				message += `💵 Last Known Value: ${agentsApi.formatCurrency(holdingsStatus.lastKnownValue)}\n`;
			}

			if (iqStatus.isRunning) {
				message += `💰 IQ Price: ${iqStatus.lastKnownPrice > 0 ? agentsApi.formatCurrency(iqStatus.lastKnownPrice) : "Unknown"}\n`;
				message += `📊 IQ Thresholds: ${iqStatus.config.minorThreshold}%/${iqStatus.config.majorThreshold}%/${iqStatus.config.criticalThreshold}%\n`;
			}

			message += `\n*Database Stats:*\n`;
			message += `📊 Price Records: ${dbStats.totalPriceRecords}\n`;
			message += `🚨 Total Alerts: ${dbStats.totalAlerts}\n`;
			message += `👁️ Watched Tokens: ${dbStats.activeWatchedTokens}/${dbStats.totalWatchedTokens}\n`;

			ctx.reply(message, { parse_mode: "Markdown" });
		});

		// Price history command
		this.bot.command("history", async (ctx) => {
			const args = ctx.message.text.split(" ");
			if (args.length < 2) {
				ctx.reply(
					"❌ Usage: /history <token_address> [limit]\nExample: /history 0x... 10",
				);
				return;
			}

			const tokenContract = args[1]!;
			const limit = args[2] ? parseInt(args[2]) : 10;

			try {
				const priceHistory = database.getPriceHistory(tokenContract, limit);
				if (priceHistory.length === 0) {
					ctx.reply("📊 No price history found for this token.");
					return;
				}

				const tokenName = priceHistory[0]?.tokenName || "Unknown Token";
				let message = `📊 *Price History for ${tokenName}:*\n\n`;

				priceHistory.forEach((record, index) => {
					const date = new Date(record.timestamp).toLocaleString();
					message += `${index + 1}. ${agentsApi.formatCurrency(record.price)} - ${date}\n`;
				});

				ctx.reply(message, { parse_mode: "Markdown" });
			} catch (error) {
				console.error("Error fetching price history:", error);
				ctx.reply("❌ Error fetching price history.");
			}
		});

		// Alerts history command
		this.bot.command("alerts", async (ctx) => {
			const limit = 10;
			try {
				const recentAlerts = database.getRecentAlerts(limit);
				if (recentAlerts.length === 0) {
					ctx.reply("📊 No recent alerts found.");
					return;
				}

				let message = `🚨 *Recent Alerts:*\n\n`;

				recentAlerts.forEach((alert, index) => {
					const date = new Date(alert.timestamp).toLocaleString();
					const type = alert.type === "price" ? "💰" : "📊";
					message += `${index + 1}. ${type} ${alert.message.slice(0, 100)}...\n`;
					message += `   📅 ${date}\n\n`;
				});

				ctx.reply(message, { parse_mode: "Markdown" });
			} catch (error) {
				console.error("Error fetching alerts:", error);
				ctx.reply("❌ Error fetching recent alerts.");
			}
		});

		// Settings command
		this.bot.command("settings", (ctx) => {
			const preferences = database.getAllPreferences();
			const holdingsStatus = this.holdingsWatcher.getStatus();

			let message = `⚙️ *Current Settings:*\n\n`;

			message += `*Holdings Configuration:*\n`;
			message += `💰 USD Threshold: ${agentsApi.formatCurrency(holdingsStatus.config.thresholdUsd)}\n`;
			message += `📊 Change Threshold: ${holdingsStatus.config.significantChangePercentage}%\n`;
			message += `⏰ Check Interval: ${holdingsStatus.config.checkInterval}s\n\n`;

			if (preferences.length > 0) {
				message += `*Stored Preferences:*\n`;
				preferences.forEach((pref) => {
					const value =
						pref.key === "holdings_threshold"
							? agentsApi.formatCurrency(parseFloat(pref.value))
							: pref.value;
					message += `${pref.key}: ${value}\n`;
				});
				message += "\n";
			}

			message += `*Configuration Commands:*\n`;
			message += `💰 /set_threshold <amount> - Set USD threshold for portfolio alerts\n`;
			message += `📊 /set_change_threshold <percentage> - Set percentage change threshold\n`;
			message += `⏰ /set_interval <seconds> - Set monitoring interval\n`;
			message += `🎯 /watch_config <address> <threshold> [interval] - Configure token monitoring\n`;
			message += `⚙️ /config - View complete configuration overview\n`;
			message += `📊 /history <token> [limit] - View price history\n`;
			message += `🚨 /alerts - View recent alerts\n`;

			ctx.reply(message, { parse_mode: "Markdown" });
		});

		// Help category handlers
		this.bot.action("help_portfolio", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					📊 Portfolio & Holdings Management

					• /portfolio - View your complete portfolio with current values, holdings breakdown, and total worth
					• /set_threshold (amount_usd) - Set USD threshold for portfolio alerts (e.g. /set_threshold 1000)
					• /set_change_threshold (percentage) - Set percentage change threshold (e.g. /set_change_threshold 10)
					• /set_interval (seconds) - Set monitoring interval in seconds (e.g. /set_interval 300)
					• /start_holdings - Begin continuous portfolio monitoring with automatic alerts
					• /stop_holdings - Stop portfolio monitoring and alerts

					Example Usage:
					/set_threshold 1000 - Alert when portfolio changes by $1000
					/set_change_threshold 10 - Alert on 10% portfolio changes
					/set_interval 300 - Check every 5 minutes
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_price", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					📈 Price Monitoring & Alerts

					• /watch (token_address) - Add token to watchlist for price change alerts
					• /watch_config (address) (threshold_%) [interval_seconds] - Configure token with custom settings
					• /watch_advanced (address) (minor_%) (major_%) (critical_%) [interval_seconds] - Advanced threshold configuration
					• /alert_config (address) (minor:on/off) (major:on/off) (critical:on/off) - Configure alert types
					• /unwatch (token_address) - Remove token from watchlist
					• /watched - View all tokens you're monitoring with latest prices
					• /start_price - Enable price monitoring service for all watched tokens
					• /stop_price - Disable price monitoring service

					Example Usage:
					/watch_config 0x123... 5 60 - Watch token, 5% threshold, 60s interval
					/watch_advanced 0x123... 2 10 20 - Advanced: 2%, 10%, 20% thresholds
					/alert_config 0x123... on off on - Enable minor & critical alerts only
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_research", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					🔍 Token Information & Research

					• /top [mcap|holders|inferences] [limit_count] - Show top performing agents (default: top 10 by market cap)
					• /info (token_address) - Get detailed agent profile including bio, stats, and creation date
					• /stats (token_address) - View comprehensive statistics: price, market cap, holders, inferences
					• /price (token_address) - Get real-time price for any agent token
					• /iq_price - Current IQ token price (base token for all agents)

					Example Usage:
					/top mcap 5 - Top 5 agents by market cap
					/top holders 10 - Top 10 agents by holder count
					/info 0x123... - Detailed agent information
					/stats 0x123... - Price, market cap, holders stats
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_iq", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					🪙 IQ Token Monitoring (Base Token)

					• /start_iq - Start IQ token price monitoring
					• /stop_iq - Stop IQ token price monitoring
					• /iq_config (minor_%) (major_%) (critical_%) [interval_seconds] - Configure IQ price thresholds
					• /iq_alerts (minor:on/off) (major:on/off) (critical:on/off) - Configure IQ alert types
					• /iq_status - View IQ monitoring status and configuration
					• /iq_price - Get current IQ token price

					Example Usage:
					/iq_config 2 10 20 60 - 2%/10%/20% thresholds, 60s interval
					/iq_alerts on off on - Enable minor & critical alerts only

					Note: IQ price changes often indicate market-wide agent price movements
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_system", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					⚙️ System & Configuration

					• /config - View current configuration and monitoring settings
					• /status - System health check: monitoring status, database stats, tracked tokens
					• /history (token_address) [limit_count] - View price history for any token (default: last 10 records)
					• /alerts - View your recent alert history and notifications
					• /settings - View current configuration and available customization options

					Example Usage:
					/history 0x123... 20 - Last 20 price records for token
					/config - See all current settings and configurations
					/status - Check if all monitoring services are running

					Pro Tips:
					• Use /config to see all your current settings
					• Lower intervals = more frequent checks but more API usage (minimum: 60 seconds)
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_getting_started", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					💡 Getting Started Guide

					Quick Setup (5 steps):
					1. /portfolio - See your current holdings
					2. /set_threshold 1000 - Set $1000 USD alert threshold
					3. /set_change_threshold 10 - Set 10% change threshold
					4. /set_interval 300 - Check every 5 minutes
					5. /start_holdings - Start monitoring!

					Advanced Setup:
					• Research agents: /top and /info (address)
					• Track specific tokens: /watch_config (address) 5 60
					• Monitor IQ token: /iq_config 2 10 20
					• Start all services: /start_price and /start_iq

					Pro Tips:
					• Set different thresholds for different monitoring needs
					• Use /watch_config for quick setup, /watch_advanced for precision
					• Enable only the alert types you need to avoid spam
					• Configure alert types with /alert_config to reduce noise
				`,
				{
					...Markup.inlineKeyboard([
						[Markup.button.callback("⬅️ Back to Help Menu", "help_main")],
					]),
				},
			);
		});

		this.bot.action("help_main", async (ctx) => {
			await ctx.answerCbQuery();
			await ctx.editMessageText(
				dedent`
					🤖 *IQ Agents Watcher Bot - Help Menu*

					Welcome! I'll help you monitor your IQ Agent investments and get notified about important changes.

					Choose a category below to learn more:
				`,
				{
					parse_mode: "Markdown",
					...Markup.inlineKeyboard([
						[
							Markup.button.callback(
								"📊 Portfolio & Holdings",
								"help_portfolio",
							),
						],
						[Markup.button.callback("📈 Price Monitoring", "help_price")],
						[Markup.button.callback("🔍 Token Research", "help_research")],
						[Markup.button.callback("🪙 IQ Token Monitoring", "help_iq")],
						[Markup.button.callback("⚙️ System & Config", "help_system")],
						[
							Markup.button.callback(
								"💡 Getting Started",
								"help_getting_started",
							),
						],
					]),
				},
			);
		});

		// Inline query handlers for start menu
		this.bot.action("portfolio_status", async (ctx) => {
			await ctx.answerCbQuery();
			ctx.telegram.sendMessage(
				ctx.chat?.id!,
				"Use /portfolio to view your current portfolio status.",
			);
		});

		this.bot.action("settings", async (ctx) => {
			await ctx.answerCbQuery();
			ctx.telegram.sendMessage(
				ctx.chat?.id!,
				"Use /help to see all configuration commands.",
			);
		});

		this.bot.action("top_agents", async (ctx) => {
			await ctx.answerCbQuery();
			ctx.telegram.sendMessage(
				ctx.chat?.id!,
				"Use /top to view top agents on atp",
			);
		});
	}

	private setupWatchers(): void {
		// Holdings watcher alerts
		this.holdingsWatcher.on("alert", (alert: HoldingsAlert) => {
			this.broadcastMessage(alert.message);
		});

		this.holdingsWatcher.on("error", (error: Error) => {
			console.error("Holdings watcher error:", error);
			this.broadcastMessage(`❌ Holdings monitoring error: ${error.message}`);
		});

		// Price watcher alerts
		this.priceWatcher.on("alert", (alert: PriceAlert) => {
			this.broadcastMessage(alert.message);
		});

		this.priceWatcher.on("error", (error: Error) => {
			console.error("Price watcher error:", error);
			this.broadcastMessage(`❌ Price monitoring error: ${error.message}`);
		});

		// IQ price watcher alerts
		this.iqPriceWatcher.on("alert", (alert: IQPriceAlert) => {
			this.broadcastMessage(alert.message);
		});

		this.iqPriceWatcher.on("error", (error: Error) => {
			console.error("IQ price watcher error:", error);
			this.broadcastMessage(`❌ IQ price monitoring error: ${error.message}`);
		});
	}

	private async broadcastMessage(message: string): Promise<void> {
		// For now, we'll just log the message
		// In a full implementation, you'd maintain a list of subscribers
		console.log("📢 Broadcast:", message);
	}

	async start(): Promise<void> {
		console.log("🚀 Starting IQ Agents Telegram Bot...");

		// Start the bot
		await this.bot.launch();
		console.log("✅ Telegram bot started successfully!");

		// Start watchers
		await this.holdingsWatcher.start();
		await this.priceWatcher.start();
		await this.iqPriceWatcher.start();

		// Graceful shutdown
		process.once("SIGINT", () => this.stop());
		process.once("SIGTERM", () => this.stop());
	}

	async stop(): Promise<void> {
		console.log("🛑 Stopping IQ Agents Telegram Bot...");

		await this.holdingsWatcher.stop();
		await this.priceWatcher.stop();
		await this.iqPriceWatcher.stop();
		this.bot.stop();

		console.log("✅ Bot stopped successfully!");
		process.exit(0);
	}
}

// Start the bot
const bot = new IQAgentsTelegramBot();
bot.start().catch((error) => {
	console.error("❌ Failed to start bot:", error);
	process.exit(1);
});
