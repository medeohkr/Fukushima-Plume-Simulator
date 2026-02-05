// streamingHYCOMLoader_DAILY.js - DAILY STREAMING
console.log('=== Streaming HYCOM Loader (Daily Optimized) ===');

class StreamingHYCOMLoader_DAILY {
    constructor() {
        this.metadata = null;
        this.gridInfo = null;
        this.loadedDays = new Map();        // dateKey -> {lonArray, latArray, uArray, vArray}
        this.cache = new Map();             // Still useful for repeated lookups
        this.activeDayKey = null;
        this.loadingPromises = new Map();   // Prevent duplicate day loads
        this.baseDate = new Date('2011-03-01T00:00:00Z'); // Base date from your conversion

        console.log("🌊 Daily HYCOM Loader initialized");
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing daily loader...');
        try {
            // 1. Load DAILY metadata
            await this.loadDailyMetadata();

            // 2. Pre-load first day immediately
            await this.loadDayByOffset(0);

            console.log('✅ Daily loader ready');
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    async loadDailyMetadata() {
        try {
            const response = await fetch('data/currents_daily_bin/currents_daily_metadata.json');
            this.metadata = await response.json();
            console.log(`✅ Daily metadata: ${this.metadata.days.length} days`);

            // Index days by offset for faster lookup
            this.daysByOffset = {};
            this.daysByDate = {};

            this.metadata.days.forEach(day => {
                this.daysByOffset[day.day_offset] = day;
                const dateKey = `${day.year}-${day.month.toString().padStart(2, '0')}-${day.day.toString().padStart(2, '0')}`;
                this.daysByDate[dateKey] = day;
            });

            return this.metadata;
        } catch (error) {
            console.error('❌ Daily metadata error:', error);
            throw error;
        }
    }

    // ==================== DAY LOADING ====================

    async loadDayByOffset(dayOffset) {
        const dayData = this.daysByOffset[dayOffset];
        if (!dayData) {
            console.error(`❌ No data for day offset ${dayOffset}`);
            return null;
        }

        return this._loadDayByDate(dayData.year, dayData.month, dayData.day);
    }

    async loadDayByDate(year, month, day) {
        const dateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        // If already loading, return the promise
        if (this.loadingPromises.has(dateKey)) {
            return this.loadingPromises.get(dateKey);
        }

        // If already loaded, return immediately
        if (this.loadedDays.has(dateKey)) {
            return this.loadedDays.get(dateKey);
        }

        console.log(`📥 Loading day ${dateKey}...`);
        const loadPromise = this._loadDayByDate(year, month, day);
        this.loadingPromises.set(dateKey, loadPromise);

        try {
            const result = await loadPromise;
            this.loadedDays.set(dateKey, result);
            this.activeDayKey = dateKey;
            return result;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }

    async _loadDayByDate(year, month, day) {
        const dateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const fileName = `currents_${year}_${month.toString().padStart(2, '0')}_${day.toString().padStart(2, '0')}.bin`;
        const filePath = `data/currents_daily_bin/${fileName}`;

        try {
            const startTime = performance.now();
            const response = await fetch(filePath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${filePath}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const loadTime = performance.now() - startTime;

            // Parse the binary format (Version 3 with day)
            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);
            const nLat = view.getInt32(4, true);
            const nLon = view.getInt32(8, true);
            const fileYear = view.getInt32(12, true);
            const fileMonth = view.getInt32(16, true);
            const fileDay = view.getInt32(20, true);
            const totalCells = nLat * nLon;

            console.log(`   Loaded ${dateKey}: ${(arrayBuffer.byteLength / (1024**2)).toFixed(1)}MB in ${loadTime.toFixed(0)}ms`);

            // Create Float32Array views DIRECTLY into the buffer
            const headerSize = 24; // 6 ints = 24 bytes for version 3
            const dataStart = headerSize;

            const dayArrays = {
                lonArray: new Float32Array(arrayBuffer, dataStart, totalCells),
                latArray: new Float32Array(arrayBuffer, dataStart + (totalCells * 4), totalCells),
                uArray: new Float32Array(arrayBuffer, dataStart + (2 * totalCells * 4), totalCells),
                vArray: new Float32Array(arrayBuffer, dataStart + (3 * totalCells * 4), totalCells),
                nLat,
                nLon,
                totalCells,
                year: fileYear,
                month: fileMonth,
                day: fileDay,
                dateKey,
                arrayBuffer, // Keep reference to prevent GC
                loadTime
            };

            // Store grid info on first load
            if (!this.gridInfo) {
                this.gridInfo = {
                    nLat,
                    nLon,
                    totalCells,
                    bytesPerArray: totalCells * 4
                };
                this.buildSpatialIndex(dayArrays.lonArray, dayArrays.latArray, nLat, nLon);
            }

            return dayArrays;

        } catch (error) {
            console.error(`❌ Failed to load day ${dateKey}:`, error);
            throw error;
        }
    }

    // ==================== DATE/DAY CONVERSION ====================

    simulationDayToDate(simulationDay) {
        // Convert simulation day to actual date
        const date = new Date(this.baseDate.getTime() + simulationDay * 24 * 60 * 60 * 1000);
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            dateKey: date.toISOString().split('T')[0]
        };
    }

    dateToSimulationDay(year, month, day) {
        const targetDate = new Date(Date.UTC(year, month - 1, day));
        const diffTime = targetDate - this.baseDate;
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    // ==================== CORE LOOKUP ====================

    async getVelocityAt(lon, lat, simulationDay = 0) {
        // Convert simulation day to date
        const dateInfo = this.simulationDayToDate(simulationDay);

        // Ensure day is loaded
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        // Find closest grid cell
        const cell = this.findNearestCell(lon, lat, dayData);

        if (!cell) {
            return { u: 0, v: 0, found: false };
        }

        // DIRECT array access
        const u = dayData.uArray[cell.idx];
        const v = dayData.vArray[cell.idx];
        const isOcean = !isNaN(u) && !isNaN(v);

        return {
            u: isOcean ? u : 0,
            v: isOcean ? v : 0,
            found: isOcean,
            cached: false,
            gridCell: [cell.i, cell.j],
            distance: cell.distance,
            date: dateInfo.dateKey
        };
    }

    async getVelocitiesAtMultiple(positions, simulationDay = 0) {
        // Convert simulation day to date
        const dateInfo = this.simulationDayToDate(simulationDay);

        // Load day once
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        const results = new Array(positions.length);

        // DIRECT array access for all positions
        for (let k = 0; k < positions.length; k++) {
            const { lon, lat } = positions[k];
            const cell = this.findNearestCell(lon, lat, dayData);

            if (cell) {
                const u = dayData.uArray[cell.idx];
                const v = dayData.vArray[cell.idx];
                const isOcean = !isNaN(u) && !isNaN(v);

                results[k] = {
                    u: isOcean ? u : 0,
                    v: isOcean ? v : 0,
                    found: isOcean,
                    gridCell: [cell.i, cell.j],
                    date: dateInfo.dateKey
                };
            } else {
                results[k] = { u: 0, v: 0, found: false, date: dateInfo.dateKey };
            }
        }

        return results;
    }

    // ==================== SPATIAL INDEX (SAME AS BEFORE) ====================

    buildSpatialIndex(lonArray, latArray, nLat, nLon) {
        console.log('🗺️ Building spatial index...');

        const GRID_SIZE = 100;
        this.spatialGrid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill([]));

        let lonMin = Infinity, lonMax = -Infinity;
        let latMin = Infinity, latMax = -Infinity;

        // Sample points for bounds
        for (let i = 0; i < lonArray.length; i += 1000) {
            lonMin = Math.min(lonMin, lonArray[i]);
            lonMax = Math.max(lonMax, lonArray[i]);
            latMin = Math.min(latMin, latArray[i]);
            latMax = Math.max(latMax, latArray[i]);
        }

        this.gridBounds = { lonMin, lonMax, latMin, latMax };

        // Build index
        for (let i = 0; i < nLat; i += 10) {
            for (let j = 0; j < nLon; j += 10) {
                const idx = i * nLon + j;
                const lon = lonArray[idx];
                const lat = latArray[idx];

                if (!isNaN(lon) && !isNaN(lat)) {
                    const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
                    const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

                    if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
                        this.spatialGrid[gridY][gridX].push({ i, j });
                    }
                }
            }
        }

        console.log(`   Spatial grid: ${GRID_SIZE}x${GRID_SIZE}`);
    }

    findNearestCell(lon, lat, dayData) {
        const { nLat, nLon } = dayData;
        const { lonArray, latArray } = dayData;

        const GRID_SIZE = 100;
        const { lonMin, lonMax, latMin, latMax } = this.gridBounds;

        const gridX = Math.floor((lon - lonMin) / (lonMax - lonMin) * (GRID_SIZE - 1));
        const gridY = Math.floor((lat - latMin) / (latMax - latMin) * (GRID_SIZE - 1));

        let bestDist = Infinity;
        let bestCell = null;

        const searchRadius = 1;
        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
            for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                const x = Math.max(0, Math.min(GRID_SIZE - 1, gridX + dx));
                const y = Math.max(0, Math.min(GRID_SIZE - 1, gridY + dy));

                const candidates = this.spatialGrid[y][x];
                for (const candidate of candidates) {
                    const { i, j } = candidate;
                    const idx = i * nLon + j;
                    const cellLon = lonArray[idx];
                    const cellLat = latArray[idx];

                    if (isNaN(cellLon) || isNaN(cellLat)) continue;

                    const dist = Math.pow(cellLon - lon, 2) + Math.pow(cellLat - lat, 2);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCell = { i, j, idx, distance: Math.sqrt(dist) };
                    }
                }
            }
        }

        return bestCell;
    }

    // ==================== MEMORY MANAGEMENT ====================

    setMaxDaysInMemory(maxDays = 7) {
        if (this.loadedDays.size > maxDays) {
            const keys = Array.from(this.loadedDays.keys());
            const toRemove = keys.slice(0, keys.length - maxDays);

            toRemove.forEach(dateKey => {
                if (dateKey !== this.activeDayKey) {
                    this.loadedDays.delete(dateKey);
                }
            });

            console.log(`🗑️ Kept ${maxDays} days in memory`);
        }
    }

    unloadDay(dateKey) {
        if (this.loadedDays.has(dateKey) && dateKey !== this.activeDayKey) {
            this.loadedDays.delete(dateKey);
            console.log(`🗑️ Unloaded day ${dateKey}`);
        }
    }

    // ==================== PRELOADING ====================

    async preloadAdjacentDays(simulationDay) {
        const daysToPreload = [];

        // Preload current, previous, and next days
        for (let offset = -1; offset <= 1; offset++) {
            const targetDay = simulationDay + offset;
            if (targetDay >= 0) {
                daysToPreload.push(targetDay);
            }
        }

        console.log(`🔍 Preloading days: ${daysToPreload.join(', ')}`);
        await Promise.all(daysToPreload.map(day => {
            const dateInfo = this.simulationDayToDate(day);
            return this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
        }));
    }

    // ==================== STATS & INFO ====================

    getStats() {
        return {
            loadedDays: this.loadedDays.size,
            totalDays: this.metadata?.days.length || 0,
            gridSize: this.gridInfo ? `${this.gridInfo.nLat}x${this.gridInfo.nLon}` : 'N/A',
            memoryUsage: this.calculateMemoryUsage(),
            activeDay: this.activeDayKey,
            dateRange: this.metadata ? {
                first: this.metadata.days[0].date_str,
                last: this.metadata.days[this.metadata.days.length - 1].date_str
            } : null
        };
    }

    calculateMemoryUsage() {
        let totalBytes = 0;
        for (const dayData of this.loadedDays.values()) {
            totalBytes += dayData.arrayBuffer.byteLength;
        }
        return `${(totalBytes / (1024**2)).toFixed(1)}MB`;
    }

    getCurrentDayInfo() {
        if (!this.activeDayKey || !this.metadata) return null;

        return {
            date: this.activeDayKey,
            daysLoaded: this.loadedDays.size,
            memoryUsage: this.calculateMemoryUsage()
        };
    }

    // ==================== LAND MASK METHODS (UPDATED) ====================

    async getLandMask(simulationDay = 0) {
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        const { nLat, nLon, uArray } = dayData;
        const mask = new Array(nLat).fill().map(() => new Array(nLon).fill(false));

        for (let i = 0; i < nLat; i++) {
            for (let j = 0; j < nLon; j++) {
                const idx = i * nLon + j;
                mask[i][j] = !isNaN(uArray[idx]);
            }
        }

        return {
            mask,
            nLat,
            nLon,
            oceanCount: mask.flat().filter(cell => cell).length,
            landCount: mask.flat().filter(cell => !cell).length,
            date: dateInfo.dateKey
        };
    }

    async isOcean(lon, lat, simulationDay = 0) {
        try {
            const dateInfo = this.simulationDayToDate(simulationDay);
            const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
            const cell = this.findNearestCell(lon, lat, dayData);

            if (!cell) return false;

            const u = dayData.uArray[cell.idx];
            return !isNaN(u);

        } catch (error) {
            console.warn('Land mask check failed:', error);
            return false;
        }
    }

    async findNearestOceanCell(lon, lat, simulationDay = 0, maxSearchRadius = 10) {
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
        const { nLat, nLon, uArray, lonArray, latArray } = dayData;

        const exactCell = this.findNearestCell(lon, lat, dayData);
        if (exactCell && !isNaN(uArray[exactCell.idx])) {
            return {
                ...exactCell,
                lon: lonArray[exactCell.idx],
                lat: latArray[exactCell.idx]
            };
        }

        const centerI = exactCell ? exactCell.i : Math.floor(nLat/2);
        const centerJ = exactCell ? exactCell.j : Math.floor(nLon/2);

        for (let radius = 1; radius <= maxSearchRadius; radius++) {
            for (let di = -radius; di <= radius; di++) {
                for (let dj = -radius; dj <= radius; dj++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== radius) continue;

                    const i = centerI + di;
                    const j = centerJ + dj;

                    if (i >= 0 && i < nLat && j >= 0 && j < nLon) {
                        const idx = i * nLon + j;
                        if (!isNaN(uArray[idx])) {
                            return {
                                i, j, idx,
                                lon: lonArray[idx],
                                lat: latArray[idx]
                            };
                        }
                    }
                }
            }
        }

        return null;
    }
}

// Global instance
window.StreamingHYCOMLoader_DAILY = StreamingHYCOMLoader_DAILY;
window.streamingHycomLoaderDaily = new StreamingHYCOMLoader_DAILY();

// Auto-initialize
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🌊 Daily HYCOM Loader initializing...');
    try {
        await window.streamingHycomLoaderDaily.init();
        console.log('✅ Daily HYCOM Loader ready');
    } catch (error) {
        console.error('❌ Daily loader failed:', error);
    }
});

console.log('=== Daily HYCOM Loader loaded ===');