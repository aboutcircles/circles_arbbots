/**
 * API Server for Price Snapshot Data
 * Provides paginated endpoints for viewing historical price snapshots
 */

import express from 'express';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const app = express();
const PORT = process.env.API_PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Database connection
const dbClient = new Client({
  host: "db-postgresql-fra1-54201-do-user-1252164-0.h.db.ondigitalocean.com",
  port: 25060,
  database: "bot_activity",
  user: "bot",
  password: process.env.LOGGERDB_PW,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Connect to database
dbClient.connect()
  .then(() => console.log('Connected to bot_activity database'))
  .catch(err => console.error('Database connection error:', err));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../observations')));

// CORS middleware
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

/**
 * GET /api/snapshots
 * Get list of snapshots with pagination
 * Query params:
 *   - limit: number of snapshots to return (default: 5)
 *   - offset: number of snapshots to skip (default: 0)
 */
app.get('/api/snapshots', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const offset = parseInt(req.query.offset as string) || 0;

    const query = `
      SELECT
        snapshot_id,
        COUNT(*) as token_count,
        MIN(timestamp) as timestamp
      FROM price_snapshot
      GROUP BY snapshot_id
      ORDER BY snapshot_id DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT snapshot_id) as total
      FROM price_snapshot
    `;

    const [snapshotsResult, countResult] = await Promise.all([
      dbClient.query(query, [limit, offset]),
      dbClient.query(countQuery)
    ]);

    res.json({
      snapshots: snapshotsResult.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

/**
 * GET /api/snapshot/:id
 * Get all price data for a specific snapshot
 * Returns token prices with statistics
 */
app.get('/api/snapshot/:id', async (req, res) => {
  try {
    const snapshotId = parseInt(req.params.id);

    if (isNaN(snapshotId)) {
      return res.status(400).json({ error: 'Invalid snapshot ID' });
    }

    const query = `
      SELECT
        token,
        pool_id,
        pool_type,
        price,
        ref_token,
        swap_amount,
        timestamp
      FROM price_snapshot
      WHERE snapshot_id = $1
      ORDER BY price DESC
    `;

    const result = await dbClient.query(query, [snapshotId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    // Calculate statistics
    const prices = result.rows.map(row => BigInt(row.price));
    const tokenCount = result.rows.length;

    // Convert to numbers for statistics (divide by 1e18 for better numbers)
    const priceNumbers = prices.map(p => Number(p) / 1e18);

    const avgPrice = priceNumbers.reduce((a, b) => a + b, 0) / tokenCount;
    const maxPrice = Math.max(...priceNumbers);
    const minPrice = Math.min(...priceNumbers);

    // Calculate median
    const sortedPrices = [...priceNumbers].sort((a, b) => a - b);
    const medianPrice = tokenCount % 2 === 0
      ? (sortedPrices[tokenCount / 2 - 1] + sortedPrices[tokenCount / 2]) / 2
      : sortedPrices[Math.floor(tokenCount / 2)];

    res.json({
      snapshot_id: snapshotId,
      timestamp: result.rows[0].timestamp,
      token_count: tokenCount,
      statistics: {
        avg_price: avgPrice,
        max_price: maxPrice,
        min_price: minPrice,
        median_price: medianPrice
      },
      tokens: result.rows.map(row => ({
        token: row.token,
        pool_id: row.pool_id,
        pool_type: row.pool_type,
        price: row.price,
        price_formatted: (Number(row.price) / 1e18).toFixed(6),
        ref_token: row.ref_token,
        swap_amount: row.swap_amount
      }))
    });
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch snapshot data' });
  }
});

/**
 * GET /api/latest-snapshot
 * Get the most recent snapshot
 */
app.get('/api/latest-snapshot', async (_req, res) => {
  try {
    const query = `
      SELECT MAX(snapshot_id) as latest_id
      FROM price_snapshot
    `;

    const result = await dbClient.query(query);

    if (result.rows[0].latest_id) {
      // Redirect to the latest snapshot
      return res.redirect(`/api/snapshot/${result.rows[0].latest_id}`);
    } else {
      return res.status(404).json({ error: 'No snapshots found' });
    }
  } catch (error) {
    console.error('Error fetching latest snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch latest snapshot' });
  }
});

/**
 * GET /api/liquidity/heatmap
 * Get aggregated liquidity data for heatmap visualization
 * Query params:
 *   - hours: time range in hours (default: 24)
 *   - min_observations: minimum number of observations required (default: 3)
 */
app.get('/api/liquidity/heatmap', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const minObservations = parseInt(req.query.min_observations as string) || 3;

    const query = `
      SELECT
        source_avatar,
        target_avatar,
        COUNT(*) as observation_count,
        AVG(measured_liquidity::numeric) as avg_liquidity,
        STDDEV(measured_liquidity::numeric) as liquidity_variance,
        MAX(measured_liquidity::numeric) as max_liquidity,
        MIN(measured_liquidity::numeric) as min_liquidity,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::float / COUNT(*) as success_rate,
        AVG(edge_score::numeric) as avg_edge_score,
        MAX(timestamp) as last_observation,
        AVG(source_token_price::numeric) as avg_source_price,
        AVG(target_token_price::numeric) as avg_target_price,
        AVG(source_token_price::numeric / NULLIF(target_token_price::numeric, 0)) as avg_price_ratio
      FROM liquidity_observations
      WHERE timestamp > NOW() - INTERVAL '${hours} hours'
      GROUP BY source_avatar, target_avatar
      HAVING COUNT(*) >= $1
      ORDER BY avg_liquidity DESC
    `;

    const result = await dbClient.query(query, [minObservations]);

    res.json({
      time_range_hours: hours,
      min_observations: minObservations,
      pair_count: result.rows.length,
      pairs: result.rows.map(row => ({
        source_avatar: row.source_avatar,
        target_avatar: row.target_avatar,
        observation_count: parseInt(row.observation_count),
        avg_liquidity: row.avg_liquidity,
        liquidity_variance: row.liquidity_variance,
        max_liquidity: row.max_liquidity,
        min_liquidity: row.min_liquidity,
        success_rate: parseFloat(row.success_rate),
        avg_edge_score: row.avg_edge_score,
        last_observation: row.last_observation,
        avg_source_price: row.avg_source_price,
        avg_target_price: row.avg_target_price,
        avg_price_ratio: row.avg_price_ratio
      }))
    });
  } catch (error) {
    console.error('Error fetching liquidity heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch liquidity heatmap data' });
  }
});

/**
 * GET /api/liquidity/top-pairs
 * Get top performing avatar pairs
 * Query params:
 *   - limit: number of pairs to return (default: 20)
 *   - sort: sort field (avg_liquidity, success_rate, observation_count) (default: avg_liquidity)
 *   - hours: time range in hours (default: 24)
 */
app.get('/api/liquidity/top-pairs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const sortField = (req.query.sort as string) || 'avg_liquidity';
    const hours = parseInt(req.query.hours as string) || 24;

    // Validate sort field to prevent SQL injection
    const validSortFields = ['avg_liquidity', 'success_rate', 'observation_count', 'max_liquidity'];
    const orderBy = validSortFields.includes(sortField) ? sortField : 'avg_liquidity';

    const query = `
      SELECT
        source_avatar,
        target_avatar,
        COUNT(*) as observation_count,
        AVG(measured_liquidity::numeric) as avg_liquidity,
        MAX(measured_liquidity::numeric) as max_liquidity,
        MIN(measured_liquidity::numeric) as min_liquidity,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::float / COUNT(*) as success_rate,
        AVG(edge_score::numeric) as avg_edge_score,
        MAX(timestamp) as last_successful_trade,
        AVG(source_token_price::numeric) as avg_source_price,
        AVG(target_token_price::numeric) as avg_target_price,
        AVG(source_token_price::numeric / NULLIF(target_token_price::numeric, 0)) as avg_price_ratio
      FROM liquidity_observations
      WHERE timestamp > NOW() - INTERVAL '${hours} hours'
      GROUP BY source_avatar, target_avatar
      HAVING COUNT(*) >= 3
      ORDER BY ${orderBy} DESC
      LIMIT $1
    `;

    const result = await dbClient.query(query, [limit]);

    res.json({
      sort_by: orderBy,
      limit,
      time_range_hours: hours,
      pairs: result.rows.map(row => ({
        source_avatar: row.source_avatar,
        target_avatar: row.target_avatar,
        observation_count: parseInt(row.observation_count),
        avg_liquidity: row.avg_liquidity,
        max_liquidity: row.max_liquidity,
        min_liquidity: row.min_liquidity,
        success_rate: parseFloat(row.success_rate),
        avg_edge_score: row.avg_edge_score,
        last_successful_trade: row.last_successful_trade,
        avg_source_price: row.avg_source_price,
        avg_target_price: row.avg_target_price,
        avg_price_ratio: row.avg_price_ratio
      }))
    });
  } catch (error) {
    console.error('Error fetching top pairs:', error);
    res.status(500).json({ error: 'Failed to fetch top pairs data' });
  }
});

/**
 * GET /api/liquidity/timeseries
 * Get time series data for a specific avatar pair
 * Query params:
 *   - source: source avatar address (required)
 *   - target: target avatar address (required)
 *   - hours: time range in hours (default: 24)
 */
app.get('/api/liquidity/timeseries', async (req, res) => {
  try {
    const sourceAvatar = req.query.source as string;
    const targetAvatar = req.query.target as string;
    const hours = parseInt(req.query.hours as string) || 24;

    if (!sourceAvatar || !targetAvatar) {
      return res.status(400).json({ error: 'source and target parameters are required' });
    }

    const query = `
      SELECT
        timestamp,
        measured_liquidity,
        required_amount,
        success,
        edge_score,
        failure_reason,
        execution_time_ms,
        source_token_price,
        target_token_price,
        ref_token
      FROM liquidity_observations
      WHERE source_avatar = $1
        AND target_avatar = $2
        AND timestamp > NOW() - INTERVAL '${hours} hours'
      ORDER BY timestamp ASC
    `;

    const result = await dbClient.query(query, [
      sourceAvatar.toLowerCase(),
      targetAvatar.toLowerCase()
    ]);

    // Calculate moving average (window of 10)
    const observations = result.rows.map((row, index, arr) => {
      const windowStart = Math.max(0, index - 9);
      const window = arr.slice(windowStart, index + 1);
      const ma10 = window.reduce((sum, r) => sum + Number(r.measured_liquidity), 0) / window.length;

      return {
        timestamp: row.timestamp,
        measured_liquidity: row.measured_liquidity,
        required_amount: row.required_amount,
        success: row.success,
        edge_score: row.edge_score,
        failure_reason: row.failure_reason,
        execution_time_ms: row.execution_time_ms,
        ma10_liquidity: ma10,
        source_token_price: row.source_token_price,
        target_token_price: row.target_token_price,
        price_ratio: row.source_token_price && row.target_token_price
          ? Number(row.source_token_price) / Number(row.target_token_price)
          : null,
        ref_token: row.ref_token
      };
    });

    res.json({
      source_avatar: sourceAvatar,
      target_avatar: targetAvatar,
      time_range_hours: hours,
      observation_count: observations.length,
      observations
    });
  } catch (error) {
    console.error('Error fetching timeseries:', error);
    res.status(500).json({ error: 'Failed to fetch timeseries data' });
  }
});

/**
 * GET /api/liquidity/stats
 * Get overall liquidity statistics
 * Query params:
 *   - hours: time range in hours (default: 24)
 */
app.get('/api/liquidity/stats', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;

    const query = `
      SELECT
        COUNT(*) as total_observations,
        COUNT(DISTINCT source_avatar) as unique_source_avatars,
        COUNT(DISTINCT target_avatar) as unique_target_avatars,
        COUNT(DISTINCT (source_avatar || target_avatar)) as unique_pairs,
        AVG(measured_liquidity::numeric) as avg_liquidity,
        MAX(measured_liquidity::numeric) as max_liquidity,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::float / COUNT(*) as overall_success_rate,
        SUM(CASE WHEN measured_liquidity::numeric = 0 THEN 1 ELSE 0 END)::float / COUNT(*) as zero_liquidity_rate
      FROM liquidity_observations
      WHERE timestamp > NOW() - INTERVAL '${hours} hours'
    `;

    const result = await dbClient.query(query);

    res.json({
      time_range_hours: hours,
      stats: {
        total_observations: parseInt(result.rows[0].total_observations),
        unique_source_avatars: parseInt(result.rows[0].unique_source_avatars),
        unique_target_avatars: parseInt(result.rows[0].unique_target_avatars),
        unique_pairs: parseInt(result.rows[0].unique_pairs),
        avg_liquidity: result.rows[0].avg_liquidity,
        max_liquidity: result.rows[0].max_liquidity,
        overall_success_rate: parseFloat(result.rows[0].overall_success_rate),
        zero_liquidity_rate: parseFloat(result.rows[0].zero_liquidity_rate)
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Price Snapshot API server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - GET /api/snapshots?limit=5&offset=0`);
  console.log(`  - GET /api/snapshot/:id`);
  console.log(`  - GET /api/latest-snapshot`);
  console.log(`  - GET /api/liquidity/heatmap?hours=24&min_observations=3`);
  console.log(`  - GET /api/liquidity/top-pairs?limit=20&sort=avg_liquidity`);
  console.log(`  - GET /api/liquidity/timeseries?source=0x...&target=0x...`);
  console.log(`  - GET /api/liquidity/stats?hours=24`);
  console.log(`\nVisualization pages:`);
  console.log(`  - http://localhost:${PORT}/ (Price Snapshots)`);
  console.log(`  - http://localhost:${PORT}/liquidity-heatmap (Liquidity Heatmap)`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await dbClient.end();
  process.exit(0);
});
