import Database from "better-sqlite3";
import { env } from "../env";
import { mkdirSync } from "fs";
import { dirname } from "path";

export interface PriceHistoryRecord {
	id?: number;
	tokenContract: string;
	tokenName: string;
	price: number;
	timestamp: number;
}

export interface AlertRecord {
	id?: number;
	type: "holdings" | "price" | "iq_price";
	tokenContract?: string;
	message: string;
	timestamp: number;
	triggered: boolean;
}

export interface UserPreference {
	key: string;
	value: string;
	updatedAt: number;
}

export interface WatchedToken {
	id?: number;
	tokenContract: string;
	tokenName: string;
	priceChangeThreshold: number; // Keep for backward compatibility
	minorThreshold: number;
	majorThreshold: number;
	criticalThreshold: number;
	checkInterval: number;
	lastPrice: number;
	lastCheckTime: number;
	isActive: boolean;
	enableMinorAlerts: boolean;
	enableMajorAlerts: boolean;
	enableCriticalAlerts: boolean;
}

class DatabaseService {
	private db: Database.Database;

	constructor(dbPath: string = "data/bot.db") {
		// Create the directory if it doesn't exist
		const dir = dirname(dbPath);
		mkdirSync(dir, { recursive: true });

		this.db = new Database(dbPath);
		this.setupTables();
		this.optimizeDatabase();
	}

	private setupTables(): void {
		// Price history table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS price_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				token_contract TEXT NOT NULL,
				token_name TEXT NOT NULL,
				price REAL NOT NULL,
				timestamp INTEGER NOT NULL
			)
		`);

		// Alerts table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS alerts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				type TEXT NOT NULL,
				token_contract TEXT,
				message TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				triggered BOOLEAN DEFAULT 0
			)
		`);

		// User preferences table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS user_preferences (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);

		// Watched tokens table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS watched_tokens (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				token_contract TEXT UNIQUE NOT NULL,
				token_name TEXT NOT NULL,
				price_change_threshold REAL NOT NULL DEFAULT 5.0,
				minor_threshold REAL NOT NULL DEFAULT 2.0,
				major_threshold REAL NOT NULL DEFAULT 10.0,
				critical_threshold REAL NOT NULL DEFAULT 20.0,
				check_interval INTEGER NOT NULL DEFAULT 60,
				last_price REAL NOT NULL DEFAULT 0.0,
				last_check_time INTEGER NOT NULL DEFAULT 0,
				is_active BOOLEAN DEFAULT 1,
				enable_minor_alerts BOOLEAN DEFAULT 1,
				enable_major_alerts BOOLEAN DEFAULT 1,
				enable_critical_alerts BOOLEAN DEFAULT 1,
				created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
				updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
			)
		`);

		// Create indexes for better performance
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_price_history_token_time
			ON price_history(token_contract, timestamp);
		`);

		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_alerts_type_time
			ON alerts(type, timestamp);
		`);

		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_watched_tokens_active
			ON watched_tokens(is_active);
		`);
	}

	private optimizeDatabase(): void {
		// Enable WAL mode for better concurrency
		this.db.pragma("journal_mode = WAL");

		// Optimize for performance
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("cache_size = 1000");
		this.db.pragma("temp_store = memory");
		this.db.pragma("mmap_size = 268435456"); // 256MB
	}

	// Price History Methods
	addPriceHistory(record: Omit<PriceHistoryRecord, "id">): void {
		const stmt = this.db.prepare(`
			INSERT INTO price_history (token_contract, token_name, price, timestamp)
			VALUES (?, ?, ?, ?)
		`);
		stmt.run(
			record.tokenContract,
			record.tokenName,
			record.price,
			record.timestamp,
		);
	}

	getPriceHistory(
		tokenContract: string,
		limit: number = 100,
	): PriceHistoryRecord[] {
		const stmt = this.db.prepare(`
			SELECT * FROM price_history
			WHERE token_contract = ?
			ORDER BY timestamp DESC
			LIMIT ?
		`);
		return stmt.all(tokenContract, limit) as PriceHistoryRecord[];
	}

	getLatestPrice(tokenContract: string): PriceHistoryRecord | null {
		const stmt = this.db.prepare(`
			SELECT * FROM price_history
			WHERE token_contract = ?
			ORDER BY timestamp DESC
			LIMIT 1
		`);
		return stmt.get(tokenContract) as PriceHistoryRecord | null;
	}

	// Clean old price history (keep last 1000 records per token)
	cleanOldPriceHistory(): void {
		this.db.exec(`
			DELETE FROM price_history
			WHERE id NOT IN (
				SELECT id FROM (
					SELECT id,
						ROW_NUMBER() OVER (PARTITION BY token_contract ORDER BY timestamp DESC) as rn
					FROM price_history
				)
				WHERE rn <= 1000
			)
		`);
	}

	// Alert Methods
	addAlert(record: Omit<AlertRecord, "id">): number {
		const stmt = this.db.prepare(`
			INSERT INTO alerts (type, token_contract, message, timestamp, triggered)
			VALUES (?, ?, ?, ?, ?)
		`);
		const result = stmt.run(
			record.type,
			record.tokenContract || null,
			record.message,
			record.timestamp,
			record.triggered ? 1 : 0,
		);
		return result.lastInsertRowid as number;
	}

	getRecentAlerts(limit: number = 50): AlertRecord[] {
		const stmt = this.db.prepare(`
			SELECT * FROM alerts
			ORDER BY timestamp DESC
			LIMIT ?
		`);
		return stmt.all(limit) as AlertRecord[];
	}

	markAlertAsTriggered(id: number): void {
		const stmt = this.db.prepare(`
			UPDATE alerts SET triggered = 1 WHERE id = ?
		`);
		stmt.run(id);
	}

	// User Preferences Methods
	setPreference(key: string, value: string): void {
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO user_preferences (key, value, updated_at)
			VALUES (?, ?, ?)
		`);
		stmt.run(key, value, Date.now());
	}

	getPreference(key: string): string | null {
		const stmt = this.db.prepare(`
			SELECT value FROM user_preferences WHERE key = ?
		`);
		const result = stmt.get(key) as { value: string } | undefined;
		return result?.value || null;
	}

	getAllPreferences(): UserPreference[] {
		const stmt = this.db.prepare(`
			SELECT * FROM user_preferences ORDER BY key
		`);
		return stmt.all() as UserPreference[];
	}

	// Watched Tokens Methods
	addWatchedToken(token: Omit<WatchedToken, "id">): number {
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO watched_tokens
			(token_contract, token_name, price_change_threshold, minor_threshold, major_threshold, critical_threshold,
			 check_interval, last_price, last_check_time, is_active, enable_minor_alerts, enable_major_alerts, enable_critical_alerts, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const result = stmt.run(
			token.tokenContract,
			token.tokenName,
			token.priceChangeThreshold,
			token.minorThreshold,
			token.majorThreshold,
			token.criticalThreshold,
			token.checkInterval,
			token.lastPrice,
			token.lastCheckTime,
			token.isActive ? 1 : 0,
			token.enableMinorAlerts ? 1 : 0,
			token.enableMajorAlerts ? 1 : 0,
			token.enableCriticalAlerts ? 1 : 0,
			Date.now(),
		);
		return result.lastInsertRowid as number;
	}

	getWatchedTokens(activeOnly: boolean = false): WatchedToken[] {
		const whereClause = activeOnly ? "WHERE is_active = 1" : "";
		const stmt = this.db.prepare(`
			SELECT id, token_contract, token_name, price_change_threshold, minor_threshold, major_threshold, critical_threshold,
			       check_interval, last_price, last_check_time, is_active, enable_minor_alerts, enable_major_alerts, enable_critical_alerts
			FROM watched_tokens
			${whereClause}
			ORDER BY created_at DESC
		`);
		const rows = stmt.all() as any[];
		return rows.map((row) => ({
			id: row.id,
			tokenContract: row.token_contract,
			tokenName: row.token_name,
			priceChangeThreshold: row.price_change_threshold,
			minorThreshold: row.minor_threshold,
			majorThreshold: row.major_threshold,
			criticalThreshold: row.critical_threshold,
			checkInterval: row.check_interval,
			lastPrice: row.last_price,
			lastCheckTime: row.last_check_time,
			isActive: row.is_active === 1,
			enableMinorAlerts: row.enable_minor_alerts === 1,
			enableMajorAlerts: row.enable_major_alerts === 1,
			enableCriticalAlerts: row.enable_critical_alerts === 1,
		}));
	}

	updateWatchedToken(
		tokenContract: string,
		updates: Partial<WatchedToken>,
	): void {
		const fields = [];
		const values = [];

		if (updates.tokenName !== undefined) {
			fields.push("token_name = ?");
			values.push(updates.tokenName);
		}
		if (updates.priceChangeThreshold !== undefined) {
			fields.push("price_change_threshold = ?");
			values.push(updates.priceChangeThreshold);
		}
		if (updates.minorThreshold !== undefined) {
			fields.push("minor_threshold = ?");
			values.push(updates.minorThreshold);
		}
		if (updates.majorThreshold !== undefined) {
			fields.push("major_threshold = ?");
			values.push(updates.majorThreshold);
		}
		if (updates.criticalThreshold !== undefined) {
			fields.push("critical_threshold = ?");
			values.push(updates.criticalThreshold);
		}
		if (updates.checkInterval !== undefined) {
			fields.push("check_interval = ?");
			values.push(updates.checkInterval);
		}
		if (updates.lastPrice !== undefined) {
			fields.push("last_price = ?");
			values.push(updates.lastPrice);
		}
		if (updates.lastCheckTime !== undefined) {
			fields.push("last_check_time = ?");
			values.push(updates.lastCheckTime);
		}
		if (updates.isActive !== undefined) {
			fields.push("is_active = ?");
			values.push(updates.isActive ? 1 : 0);
		}
		if (updates.enableMinorAlerts !== undefined) {
			fields.push("enable_minor_alerts = ?");
			values.push(updates.enableMinorAlerts ? 1 : 0);
		}
		if (updates.enableMajorAlerts !== undefined) {
			fields.push("enable_major_alerts = ?");
			values.push(updates.enableMajorAlerts ? 1 : 0);
		}
		if (updates.enableCriticalAlerts !== undefined) {
			fields.push("enable_critical_alerts = ?");
			values.push(updates.enableCriticalAlerts ? 1 : 0);
		}

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(Date.now());
		values.push(tokenContract);

		const stmt = this.db.prepare(`
			UPDATE watched_tokens
			SET ${fields.join(", ")}
			WHERE token_contract = ?
		`);
		stmt.run(...values);
	}

	removeWatchedToken(tokenContract: string): void {
		const stmt = this.db.prepare(`
			UPDATE watched_tokens SET is_active = 0, updated_at = ?
			WHERE token_contract = ?
		`);
		stmt.run(Date.now(), tokenContract);
	}

	getWatchedToken(tokenContract: string): WatchedToken | null {
		const stmt = this.db.prepare(`
			SELECT * FROM watched_tokens
			WHERE token_contract = ? AND is_active = 1
		`);
		return stmt.get(tokenContract) as WatchedToken | null;
	}

	// Statistics Methods
	getStats(): {
		totalPriceRecords: number;
		totalAlerts: number;
		totalWatchedTokens: number;
		activeWatchedTokens: number;
	} {
		const priceCount = this.db
			.prepare("SELECT COUNT(*) as count FROM price_history")
			.get() as { count: number };
		const alertCount = this.db
			.prepare("SELECT COUNT(*) as count FROM alerts")
			.get() as { count: number };
		const watchedCount = this.db
			.prepare("SELECT COUNT(*) as count FROM watched_tokens")
			.get() as { count: number };
		const activeWatchedCount = this.db
			.prepare(
				"SELECT COUNT(*) as count FROM watched_tokens WHERE is_active = 1",
			)
			.get() as { count: number };

		return {
			totalPriceRecords: priceCount.count,
			totalAlerts: alertCount.count,
			totalWatchedTokens: watchedCount.count,
			activeWatchedTokens: activeWatchedCount.count,
		};
	}

	// Maintenance Methods
	vacuum(): void {
		this.db.exec("VACUUM");
	}

	backup(backupPath: string): void {
		this.db.backup(backupPath);
	}

	close(): void {
		this.db.close();
	}

	// Transaction support
	transaction<T>(fn: () => T): T {
		const trx = this.db.transaction(fn);
		return trx();
	}
}

// Create singleton instance
export const database = new DatabaseService(
	env.NODE_ENV === "production" ? "/data/bot.db" : "data/bot.db",
);

export default database;
