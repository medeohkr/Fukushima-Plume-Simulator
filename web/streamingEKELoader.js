// StreamingEKELoader.js - Optimized for ultra-compressed EKE data
console.log('=== Streaming EKE Loader (Ultra-Optimized) ===');

class StreamingEKELoader {
    constructor() {
        this.metadata = null;
        this.coordsInfo = null;
        this.lonGrid = null;
        this.latGrid = null;
        this.loadedDays = new Map();     // dateKey -> {KArray (float16)}
        this.cache = new Map();          // For repeated spatial lookups
        this.activeDate = null;
        this.loadingPromises = new Map();

        console.log("🌀 Streaming EKE Loader initialized (3.9MB/day)");
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing optimized EKE loader...');
        try {
            // 1. Load metadata
            await this.loadMetadata();

            // 2. Load coordinates ONCE
            await this.loadCoordinates();

            // 3. Pre-load first day
            const firstDate = this.metadata.dates[0];
            await this.loadDay(firstDate);
            // Add this to StreamingEKELoader.js init():
            console.log('📅 Available EKE dates:', this.metadata.dates.slice(0, 10), '...');
            console.log('✅ EKE loader ready (2.8GB total, 3.9MB/day)');
            return true;
        } catch (error) {
            console.error('❌ EKE loader initialization failed:', error);
            return false;
        }
    }

    async loadMetadata() {
        try {
            const response = await fetch('data/eke_ultra_optimized/eke_metadata.json');
            this.metadata = await response.json();
            console.log(`✅ Metadata: ${this.metadata.total_days} days (${this.metadata.storage_summary.estimated_total_gb.toFixed(1)}GB)`);
            return this.metadata;
        } catch (error) {
            console.error('❌ Metadata error:', error);
            throw error;
        }
    }

    async loadCoordinates() {
        try {
            console.log('🗺️ Loading coordinates (once)...');
            const response = await fetch('data/eke_ultra_optimized/eke_coords.bin');
            const arrayBuffer = await response.arrayBuffer();

            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);
            const nLat = view.getInt32(4, true);
            const nLon = view.getInt32(8, true);
            const totalCells = nLat * nLon;

            console.log(`  ✓ Grid: ${nLat}×${nLon} (${totalCells.toLocaleString()} cells)`);

            // Read coordinates (float32)
            const headerSize = 12; // 3 ints
            const lonArray = new Float32Array(arrayBuffer, headerSize, totalCells);
            const latArray = new Float32Array(arrayBuffer, headerSize + totalCells * 4, totalCells);

            // Store as 2D views (no copy - just views into the buffer)
            this.lonGrid = new Float32Array(arrayBuffer, headerSize, totalCells);
            this.latGrid = new Float32Array(arrayBuffer, headerSize + totalCells * 4, totalCells);

            this.coordsInfo = {
                nLat,
                nLon,
                totalCells,
                headerSize,
                arrayBuffer // Keep reference to prevent GC
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
        console.log('🗺️ Building spatial index for fast lookups...');

        const { nLat, nLon } = this.coordsInfo;
        const GRID_SIZE = 50; // Smaller grid for faster initialization

        this.spatialGrid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill([]));

        // Find bounds
        let lonMin = Infinity, lonMax = -Infinity;
        let latMin = Infinity, latMax = -Infinity;

        // Sample points for bounds (every 100th point)
        for (let i = 0; i < this.lonGrid.length; i += 100) {
            lonMin = Math.min(lonMin, this.lonGrid[i]);
            lonMax = Math.max(lonMax, this.lonGrid[i]);
            latMin = Math.min(latMin, this.latGrid[i]);
            latMax = Math.max(latMax, this.latGrid[i]);
        }

        this.gridBounds = { lonMin, lonMax, latMin, latMax };

        // Build index (sample every 20th point for speed)
        for (let i = 0; i < nLat; i += 20) {
            for (let j = 0; j < nLon; j += 20) {
                const idx = i * nLon + j;
                const lon = this.lonGrid[idx];
                const lat = this.latGrid[idx];

                if (!isNaN(lon) && !isNaN(lat)) {
                    const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
                    const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

                    if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
                        this.spatialGrid[gridY][gridX].push({ i, j, idx });
                    }
                }
            }
        }

        console.log(`  ✓ Spatial grid: ${GRID_SIZE}×${GRID_SIZE}`);
    }

    // ==================== DAY LOADING ====================

    async loadDay(dateKey) {
        // If already loading, return the promise
        if (this.loadingPromises.has(dateKey)) {
            return this.loadingPromises.get(dateKey);
        }

        // If already loaded, return immediately
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

            // Keep only 3 days in memory at once
            this.manageMemory();

            return result;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }

    async _loadDayData(dateKey) {
        const filePath = `data/eke_ultra_optimized/daily/eke_${dateKey}.bin`;

        try {
            const startTime = performance.now();
            const response = await fetch(filePath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${filePath}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const loadTime = performance.now() - startTime;

            // Parse the optimized binary format (Version 6)
            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);
            const year = view.getInt32(4, true);
            const month = view.getInt32(8, true);
            const day = view.getInt32(12, true);
            const maxErrorScaled = view.getInt32(16, true);
            const maxError = maxErrorScaled / 1000.0;

            // Read float16 K values
            const headerSize = 20; // 5 ints
            const totalCells = this.coordsInfo.totalCells;

            // Create a Uint16Array view for the float16 data
            const uint16Array = new Uint16Array(arrayBuffer, headerSize, totalCells);

            const dayData = {
                year,
                month,
                day,
                dateKey,
                maxError,
                uint16Array, // Store as uint16 to preserve float16 bits
                arrayBuffer, // Keep reference
                loadTime,
                size: arrayBuffer.byteLength
            };

            console.log(`   ✓ ${dateKey}: ${(arrayBuffer.byteLength / (1024**2)).toFixed(2)}MB in ${loadTime.toFixed(0)}ms`);

            // ============ ADD TEST CODE HERE ============
            console.log(`   🔍 Testing EKE values for ${dateKey}:`);
            const testPoints = [
                {lon: 141.5, lat: 39.6},  // Near Fukushima
                {lon: 145.0, lat: 40.0},  // East of Japan
                {lon: 150.0, lat: 35.0},  // Further east
                {lon: 180.0, lat: 45.0}   // Middle of Pacific
            ];

            for (const point of testPoints) {
                const cell = this.findNearestCell(point.lon, point.lat, dayData);
                if (cell) {
                    const uint16Value = dayData.uint16Array[cell.idx];
                    const K = this.uint16ToFloat32(uint16Value);
                    console.log(`     (${point.lon.toFixed(1)}°, ${point.lat.toFixed(1)}°) → K=${K.toFixed(1)} m²/s`);
                } else {
                    console.log(`     (${point.lon.toFixed(1)}°, ${point.lat.toFixed(1)}°) → No cell found`);
                }
            }
            // ============ END TEST CODE ============

            return dayData;

        } catch (error) {
            console.error(`❌ Failed to load day ${dateKey}:`, error);
            throw error;
        }
    }

    // ==================== CORE LOOKUP ====================

    uint16ToFloat32(uint16) {
        // Convert float16 (stored as uint16) to float32
        // Simple implementation - for better precision, use a proper conversion
        if (uint16 === 0) return 0;

        const sign = (uint16 & 0x8000) ? -1 : 1;
        const exponent = (uint16 >> 10) & 0x1F;
        const fraction = uint16 & 0x3FF;

        if (exponent === 0) {
            return sign * Math.pow(2, -14) * (fraction / 1024);
        } else if (exponent === 31) {
            return fraction === 0 ? sign * Infinity : NaN;
        }

        return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
    }

    async getDiffusivityAt(lon, lat, dateKey = null) {
        // Use current date if not specified
        if (!dateKey && this.activeDate) {
            dateKey = this.activeDate;
        } else if (!dateKey) {
            dateKey = this.metadata.dates[0];
        }

        // Load the day if needed
        const dayData = await this.loadDay(dateKey);

        // Find nearest grid cell
        const cell = this.findNearestCell(lon, lat);

        if (!cell) {
            return {
                K: this.metadata.physics.bounds.min_K,
                found: false,
                cached: false
            };
        }

        // Convert float16 to float32 for this specific cell
        const uint16Value = dayData.uint16Array[cell.idx];
        const K = this.uint16ToFloat32(uint16Value);

        // Validate K is within bounds
        const validK = isNaN(K) || K < 20 ? 20.0 : Math.min(K, 500.0);

        return {
            K: validK,
            found: true,
            cached: false,
            gridCell: [cell.i, cell.j],
            date: dateKey,
            maxError: dayData.maxError
        };
    }

    async getDiffusivitiesAtMultiple(positions, dateKey = null) {
        // Use current date if not specified
        if (!dateKey && this.activeDate) {
            dateKey = this.activeDate;
        } else if (!dateKey) {
            dateKey = this.metadata.dates[0];
        }

        // Load the day
        const dayData = await this.loadDay(dateKey);
        const results = new Array(positions.length);

        for (let k = 0; k < positions.length; k++) {
            const { lon, lat } = positions[k];
            const cell = this.findNearestCell(lon, lat);

            if (cell) {
                const uint16Value = dayData.uint16Array[cell.idx];
                const K = this.uint16ToFloat32(uint16Value);
                const validK = isNaN(K) || K < 20 ? 20.0 : Math.min(K, 500.0);

                results[k] = {
                    K: validK,
                    found: true,
                    gridCell: [cell.i, cell.j]
                };
            } else {
                results[k] = {
                    K: this.metadata.physics.bounds.min_K,
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

        // Use spatial grid for initial guess
        const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
        const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

        let bestDist = Infinity;
        let bestCell = null;

        // Search in 2x2 neighborhood
        const searchRadius = 1;
        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const x = Math.max(0, Math.min(GRID_SIZE - 1, gridX + dx));
                const y = Math.max(0, Math.min(GRID_SIZE - 1, gridY + dy));

                const candidates = this.spatialGrid[y][x];
                for (const candidate of candidates) {
                    const cellLon = this.lonGrid[candidate.idx];
                    const cellLat = this.latGrid[candidate.idx];

                    if (isNaN(cellLon) || isNaN(cellLat)) continue;

                    const dist = Math.pow(cellLon - lon, 2) + Math.pow(cellLat - lat, 2);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCell = candidate;
                    }
                }
            }
        }

        return bestCell;
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

            // Optional: force garbage collection hint
            if (typeof gc === 'function') {
                gc();
            }
        }
    }

    unloadDay(dateKey) {
        if (this.loadedDays.has(dateKey) && dateKey !== this.activeDate) {
            this.loadedDays.delete(dateKey);
            console.log(`🗑️ Unloaded EKE day ${dateKey}`);
        }
    }

    // ==================== DATE MANAGEMENT ====================

    // In StreamingEKELoader.js, fix the date conversion:

    getDateFromSimulationDay(simulationDay) {
        // Convert simulation day (0 = March 11, 2011) to date key YYYYMMDD
        const startDate = new Date('2011-03-11T00:00:00Z');
        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + Math.floor(simulationDay));

        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');

        const dateKey = `${year}${month}${day}`;

        // Find the closest available date in our metadata
        if (!this.metadata || !this.metadata.dates || this.metadata.dates.length === 0) {
            return dateKey; // Fallback
        }

        // If exact date exists, use it
        if (this.metadata.dates.includes(dateKey)) {
            return dateKey;
        }

        // Otherwise find the closest date (usually the next available)
        const dates = this.metadata.dates.sort();
        for (let i = 0; i < dates.length; i++) {
            if (dates[i] >= dateKey) {
                return dates[i];
            }
        }

        // Fallback to last date
        return dates[dates.length - 1];
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

        // Coordinates
        if (this.coordsInfo?.arrayBuffer) {
            totalBytes += this.coordsInfo.arrayBuffer.byteLength;
        }

        // Loaded days
        for (const dayData of this.loadedDays.values()) {
            totalBytes += dayData.size;
        }

        return `${(totalBytes / (1024**2)).toFixed(1)}MB`;
    }

    getCurrentDateInfo() {
        if (!this.activeDate || !this.metadata) return null;

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

// Auto-initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🌀 Ultra-Optimized EKE Loader initializing...');
    try {
        await window.streamingEkeLoader.init();
        console.log('✅ Ultra-Optimized EKE Loader ready!');
        console.log('   📊 3.9MB/day, 2.8GB total, 84% smaller than original');

        // Test lookup
        const testResult = await window.streamingEkeLoader.getDiffusivityAt(141.5, 39.6);
        console.log(`🧪 Test lookup: K=${testResult.K.toFixed(1)} m²/s at ${testResult.date}`);

    } catch (error) {
        console.error('❌ EKE loader failed:', error);
    }
});

console.log('=== Ultra-Optimized EKE Loader loaded ===');