import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
	TELEGRAM_BOT_TOKEN: z
		.string()
		.min(1, "Telegram bot token is required")
		.describe(
			"Telegram bot token obtained from @BotFather for authenticating with Telegram API",
		),
	WALLET_ADDRESS: z
		.string()
		.regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address format")
		.describe(
			"Ethereum wallet address (0x format) to monitor for IQ agent investments on Fraxtal network",
		),
	IQ_API_BASE_URL: z
		.url()
		.default("https://app.iqai.com/api")
		.describe(
			"Base URL for IQ AI API endpoints used to fetch agent data and prices",
		),
	HOLDINGS_CHECK_INTERVAL: z
		.string()
		.optional()
		.default("300")
		.transform(Number)
		.describe(
			"Interval in seconds between portfolio holdings checks (default: 300s = 5 minutes)",
		),
	PRICE_CHECK_INTERVAL: z
		.string()
		.optional()
		.default("60")
		.transform(Number)
		.describe(
			"Interval in seconds between price checks for watched tokens (default: 60s = 1 minute)",
		),
	DEFAULT_HOLDINGS_THRESHOLD: z
		.string()
		.optional()
		.default("1000")
		.transform(Number)
		.describe(
			"Default threshold in USD for portfolio value change notifications (default: $1000)",
		),
	DEFAULT_PRICE_CHANGE_THRESHOLD: z
		.string()
		.optional()
		.default("2")
		.transform(Number)
		.describe(
			"Default percentage threshold for price change notifications (default: 2%)",
		),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development")
		.describe(
			"Runtime environment mode affecting logging and error handling behavior",
		),
	LOG_LEVEL: z
		.enum(["debug", "info", "warn", "error"])
		.default("info")
		.describe("Minimum log level to output (debug < info < warn < error)"),
	AUTHORIZED_USER_ID: z
		.string()
		.optional()
		.default("")
		.transform((val) => (val === "" ? null : Number(val)))
		.describe(
			"Single authorized Telegram user ID who can interact with the bot (empty = allow all users)",
		),
});

export type EnvConfig = z.infer<typeof envSchema>;

function validateEnv(): EnvConfig {
	try {
		return envSchema.parse(process.env);
	} catch (error) {
		console.error("❌ Environment validation failed:");
		if (error instanceof z.ZodError) {
			for (const err of error.issues) {
				console.error(`  - ${err.path.join(".")}: ${err.message}`);
			}
		}
		process.exit(1);
	}
}

export const env = validateEnv();
