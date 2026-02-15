// StreamingEKELoader.js - Optimized for EKE data (version 1, float32)
console.log('=== Streaming EKE Loader ===');

class StreamingEKELoader {
    constructor() {
        this.metadata = null;
        this.coordsInfo = null;
        this.lonGrid = null;
        this.latGrid = null;
        this.loadedDays = new Map();     // dateKey -> {KArray (float32)}
        this.cache = new Map();          // For repeated spatial lookups
        this.activeDate = null;
        this.loadingPromises = new Map();

        console.log("🌀 Streaming EKE Loader initialized");
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing EKE loader...');
        try {
            // 1. Load metadata
            await this.loadMetadata();

            // 2. Load coordinates ONCE
            await this.loadCoordinates();

            // 3. Pre-load first day
            const firstDate = this.metadata.dates[0];
            await this.loadDay(firstDate);

            console.log('📅 Available EKE dates:', this.metadata.dates.slice(0, 5), '...');
            console.log('✅ EKE loader ready');
            return true;
        } catch (error) {
            console.error('❌ EKE loader initialization failed:', error);
            return false;
        }
    }

    async loadMetadata() {
        try {
            const response = await fetch('../data/EKE_bin/eke_metadata.json');
            this.metadata = await response.json();
            console.log(`✅ Metadata: ${this.metadata.total_days} days`);
            return this.metadata;
        } catch (error) {
            console.error('❌ Metadata error:', error);
            throw error;
        }
    }

    async loadCoordinates() {
        try {
            console.log('🗺️ Loading coordinates (once)...');
            const response = await fetch('../data/EKE_bin/eke_coords.bin');
            const arrayBuffer = await response.arrayBuffer();

            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);
            const nLat = view.getInt32(4, true);
            const nLon = view.getInt32(8, true);
            const totalCells = nLat * nLon;

            console.log(`  ✓ Grid: ${nLat}×${nLon} (${totalCells.toLocaleString()} cells)`);
            console.log(`  ✓ Version: ${version}`);

            // Read coordinates (float32)
            const headerSize = 12; // 3 ints
            const lonArray = new Float32Array(arrayBuffer, headerSize, totalCells);
            const latArray = new Float32Array(arrayBuffer, headerSize + totalCells * 4, totalCells);

            // Store as 2D views
            this.lonGrid = lonArray;
            this.latGrid = latArray;

            this.coordsInfo = {
                nLat,
                nLon,
                totalCells,
                headerSize,
                arrayBuffer // Keep reference
            };

            // Build spatial index for fast lookups
            this.buildSpatialIndex();

            console.log(`  ✓ Coordinates loaded: ${(arrayBuffer.byteLength / (1024**2)).toFixed(1)}MB`);
            return this.coordsInfo;

        } catch (error) {
            console.error('❌ Coordinates error:', error);
            throw error;
        }
    }

    buildSpatialIndex() {
        console.log('🗺️ Building spatial index...');

        const { nLat, nLon } = this.coordsInfo;
        const GRID_SIZE = 50;

        this.spatialGrid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill([]));

        // Find bounds
        let lonMin = Infinity, lonMax = -Infinity;
        let latMin = Infinity, latMax = -Infinity;

        for (let i = 0; i < this.lonGrid.length; i += 100) {
            lonMin = Math.min(lonMin, this.lonGrid[i]);
            lonMax = Math.max(lonMax, this.lonGrid[i]);
            latMin = Math.min(latMin, this.latGrid[i]);
            latMax = Math.max(latMax, this.latGrid[i]);
        }

        this.gridBounds = { lonMin, lonMax, latMin, latMax };

        // Build index
        for (let i = 0; i < nLat; i += 20) {
            for (let j = 0; j < nLon; j += 20) {
                const idx = i * nLon + j;
                const lon = this.lonGrid[idx];
                const lat = this.latGrid[idx];

                if (!isNaN(lon) && !isNaN(lat)) {
                    const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
                    const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

                    if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
                        if (!this.spatialGrid[gridY][gridX].length) {
                            this.spatialGrid[gridY][gridX] = { i, j, idx };
                        }
                    }
                }
            }
        }

        console.log(`  ✓ Spatial grid: ${GRID_SIZE}×${GRID_SIZE}`);
    }

    // ==================== DAY LOADING ====================

    async loadDay(dateKey) {
        if (this.loadingPromises.has(dateKey)) {
            return this.loadingPromises.get(dateKey);
        }

        if (this.loadedDays.has(dateKey)) {
            return this.loadedDays.get(dateKey);
        }

        console.log(`📥 Loading EKE day: ${dateKey}...`);
        const loadPromise = this._loadDayData(dateKey);
        this.loadingPromises.set(dateKey, loadPromise);

        try {
            const result = await loadPromise;
            this.loadedDays.set(dateKey, result);
            this.activeDate = dateKey;

            // Keep only 3 days in memory
            this.manageMemory();

            return result;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }

    async _loadDayData(dateKey) {
        const filePath = `../data/EKE_bin/daily/eke_${dateKey}.bin`;

        try {
            const startTime = performance.now();
            const response = await fetch(filePath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${filePath}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const loadTime = performance.now() - startTime;

            // Parse version 1 binary format (4 ints + float32 data)
            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);
            const year = view.getInt32(4, true);
            const month = view.getInt32(8, true);
            const day = view.getInt32(12, true);

            console.log(`    Header: v${version}, ${year}-${month}-${day}`);

            // Read float32 K values directly
            const headerSize = 16; // 4 ints
            const totalCells = this.coordsInfo.totalCells;

            // Create Float32Array view directly - NO conversion needed!
            const K_float32 = new Float32Array(arrayBuffer, headerSize, totalCells);

            const dayData = {
                year,
                month,
                day,
                dateKey,
                K: K_float32,  // Direct float32 values
                arrayBuffer,
                loadTime,
                size: arrayBuffer.byteLength
            };

            console.log(`   ✓ ${dateKey}: ${(arrayBuffer.byteLength / (1024**2)).toFixed(2)}MB in ${loadTime.toFixed(0)}ms`);

            // Test some values
            console.log(`   🔍 Testing EKE values for ${dateKey}:`);
            const testPoints = [
                {lon: 141.5, lat: 39.6},  // Near Fukushima
                {lon: 145.0, lat: 40.0},  // East of Japan
                {lon: 150.0, lat: 35.0},  // Further east
                {lon: 180.0, lat: 45.0}   // Middle of Pacific
            ];

            for (const point of testPoints) {
                const cell = this.findNearestCell(point.lon, point.lat);
                if (cell) {
                    const K = dayData.K[cell.idx];
                    console.log(`     (${point.lon.toFixed(1)}°, ${point.lat.toFixed(1)}°) → K=${K.toFixed(1)} m²/s`);
                } else {
                    console.log(`     (${point.lon.toFixed(1)}°, ${point.lat.toFixed(1)}°) → No cell found`);
                }
            }

            return dayData;

        } catch (error) {
            console.error(`❌ Failed to load day ${dateKey}:`, error);
            throw error;
        }
    }

    // ==================== CORE LOOKUP ====================

    async getDiffusivityAt(lon, lat, dateParam = null) {
        let dateKey;

        if (dateParam === null) {
            dateKey = this.activeDate || this.metadata.dates[0];
        } else if (typeof dateParam === 'number') {
            dateKey = this.getDateFromSimulationDay(dateParam);
        } else if (typeof dateParam === 'string') {
            if (dateParam.includes('.')) {
                const simDay = parseFloat(dateParam);
                dateKey = this.getDateFromSimulationDay(simDay);
            } else {
                dateKey = dateParam;
            }
        } else {
            dateKey = this.metadata.dates[0];
        }

        if (!/^\d{8}$/.test(dateKey)) {
            console.error(`❌ Invalid dateKey: "${dateKey}"`);
            dateKey = this.metadata.dates[0];
        }

        const dayData = await this.loadDay(dateKey);
        const cell = this.findNearestCell(lon, lat);

        if (!cell) {
            return {
                K: 20.0, // Minimum value
                found: false,
                date: dateKey
            };
        }

        const K = dayData.K[cell.idx]; // Direct float32 access
        const validK = isNaN(K) || K < 20 ? 20.0 : Math.min(K, 500.0);

        return {
            K: validK,
            found: true,
            gridCell: [cell.i, cell.j],
            date: dateKey
        };
    }

    async getDiffusivitiesAtMultiple(positions, dateKey = null) {
        if (!dateKey && this.activeDate) {
            dateKey = this.activeDate;
        } else if (!dateKey) {
            dateKey = this.metadata.dates[0];
        }

        const dayData = await this.loadDay(dateKey);
        const results = new Array(positions.length);

        for (let k = 0; k < positions.length; k++) {
            const { lon, lat } = positions[k];
            const cell = this.findNearestCell(lon, lat);

            if (cell) {
                const K = dayData.K[cell.idx];
                const validK = isNaN(K) || K < 20 ? 20.0 : Math.min(K, 500.0);
                results[k] = {
                    K: validK,
                    found: true,
                    gridCell: [cell.i, cell.j]
                };
            } else {
                results[k] = {
                    K: 20.0,
                    found: false
                };
            }
        }

        return results;
    }

    findNearestCell(lon, lat) {
        const { nLat, nLon } = this.coordsInfo;
        const { lonMin, lonMax, latMin, latMax } = this.gridBounds;
        const GRID_SIZE = this.spatialGrid.length;

        const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
        const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

        if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) {
            return null;
        }

        return this.spatialGrid[gridY][gridX];
    }

    // ==================== MEMORY MANAGEMENT ====================

    manageMemory(maxDays = 3) {
        if (this.loadedDays.size > maxDays) {
            const keys = Array.from(this.loadedDays.keys());
            const toRemove = keys.slice(0, keys.length - maxDays);

            toRemove.forEach(dateKey => {
                if (dateKey !== this.activeDate) {
                    this.loadedDays.delete(dateKey);
                }
            });
        }
    }

    // ==================== DATE MANAGEMENT ====================

    getDateFromSimulationDay(simulationDay) {
        const dayInteger = Math.floor(simulationDay);
        const startDate = new Date('2011-03-11T00:00:00Z');
        const targetDate = new Date(startDate);
        targetDate.setUTCDate(startDate.getUTCDate() + dayInteger);

        const year = targetDate.getUTCFullYear();
        const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getUTCDate()).padStart(2, '0');

        return `${year}${month}${day}`;
    }

    async setSimulationDay(simulationDay) {
        const dateKey = this.getDateFromSimulationDay(simulationDay);
        console.log(`📅 Setting EKE date: day ${simulationDay.toFixed(1)} → ${dateKey}`);
        await this.loadDay(dateKey);
        return dateKey;
    }

    // ==================== STATS & INFO ====================

    getStats() {
        return {
            loadedDays: this.loadedDays.size,
            totalDays: this.metadata?.total_days || 0,
            gridSize: this.coordsInfo ? `${this.coordsInfo.nLat}×${this.coordsInfo.nLon}` : 'N/A',
            activeDate: this.activeDate,
            memoryUsage: this.calculateMemoryUsage()
        };
    }

    calculateMemoryUsage() {
        let totalBytes = 0;
        if (this.coordsInfo?.arrayBuffer) {
            totalBytes += this.coordsInfo.arrayBuffer.byteLength;
        }
        for (const dayData of this.loadedDays.values()) {
            totalBytes += dayData.size;
        }
        return `${(totalBytes / (1024**2)).toFixed(1)}MB`;
    }

    getCurrentDateInfo() {
        if (!this.activeDate) return null;
        return {
            date: this.activeDate,
            year: parseInt(this.activeDate.substring(0, 4)),
            month: parseInt(this.activeDate.substring(4, 6)),
            day: parseInt(this.activeDate.substring(6, 8))
        };
    }
}

// ==================== GLOBAL INSTANCE ====================

window.StreamingEKELoader = StreamingEKELoader;
window.streamingEkeLoader = new StreamingEKELoader();

// Auto-initialize
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🌀 EKE Loader initializing...');
    try {
        await window.streamingEkeLoader.init();
        console.log('✅ EKE Loader ready!');

        // Test lookup
        const testResult = await window.streamingEkeLoader.getDiffusivityAt(141.5, 39.6);
        console.log(`🧪 Test lookup: K=${testResult.K.toFixed(1)} m²/s at ${testResult.date}`);

    } catch (error) {
        console.error('❌ EKE loader failed:', error);
    }
});

console.log('=== EKE Loader loaded ===');