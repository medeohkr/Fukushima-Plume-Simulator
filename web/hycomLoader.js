// streamingHYCOMLoader_3D.js - 3D MULTI-DEPTH STREAMING
console.log('=== Streaming HYCOM Loader 3D (Multi-Depth Optimized) ===');

class StreamingHYCOMLoader_3D {
    constructor() {
        this.metadata = null;
        this.gridInfo = null;
        this.loadedDays = new Map();        // dateKey -> {lonArray, latArray, uArray, vArray, nDepth}
        this.cache = new Map();             // Still useful for repeated lookups
        this.activeDayKey = null;
        this.loadingPromises = new Map();   // Prevent duplicate day loads
        this.baseDate = new Date('2011-03-01T00:00:00Z');
        this.spatialGrid = null;
        this.gridBounds = null;
        this.defaultDepth = 0;              // Default to surface layer

        console.log("🌊 3D HYCOM Loader initialized (Multi-Depth)");
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing 3D loader...');
        try {
            // 1. Load 3D metadata with depths
            await this.loadMetadata3D();

            // 2. Pre-load first day immediately
            await this.loadDayByOffset(0);

            console.log('✅ 3D loader ready');
            console.log(`📊 Available depths: ${this.metadata.depths.join(', ')}m`);
            return true;
        } catch (error) {
            console.error('❌ 3D Initialization failed:', error);
            return false;
        }
    }

    async loadMetadata3D() {
        try {
            const response = await fetch('../data/currents_3d_bin/currents_3d_metadata.json');
            this.metadata = await response.json();

            console.log(`✅ 3D metadata loaded:`);
            console.log(`   • ${this.metadata.days.length} days`);
            console.log(`   • ${this.metadata.depths.length} depths: ${this.metadata.depths.join(', ')}m`);
            console.log(`   • Bounding box: ${this.metadata.bounding_box.north}N, ${this.metadata.bounding_box.south}S, ${this.metadata.bounding_box.east}E, ${this.metadata.bounding_box.west}W`);

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
            console.error('❌ 3D metadata error:', error);
            throw error;
        }
    }

    // ==================== DAY LOADING (3D) ====================

    async loadDayByOffset(dayOffset) {
        const dayData = this.daysByOffset[dayOffset];
        if (!dayData) {
            console.error(`❌ No data for day offset ${dayOffset}`);
            return null;
        }

        return this._loadDayByDate3D(dayData.year, dayData.month, dayData.day);
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

        console.log(`📥 Loading 3D day ${dateKey}...`);
        const loadPromise = this._loadDayByDate3D(year, month, day);
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

    async _loadDayByDate3D(year, month, day) {
        const dateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const fileName = `currents_${year}_${month.toString().padStart(2, '0')}_${day.toString().padStart(2, '0')}.bin`;
        const filePath = `../data/currents_3d_bin/${fileName}`;

        try {
            const startTime = performance.now();
            const response = await fetch(filePath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${filePath}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const loadTime = performance.now() - startTime;

            // Parse the binary format (Version 4 with depth)
            const view = new DataView(arrayBuffer);
            const version = view.getInt32(0, true);

            let dayArrays;

            if (version === 4) {
                // Version 4: Multi-depth format
                dayArrays = this._parseVersion4(view, arrayBuffer, dateKey);
            } else if (version === 3) {
                // Version 3: Single depth (for backward compatibility)
                dayArrays = this._parseVersion3(view, arrayBuffer, dateKey);
                dayArrays.nDepth = 1; // Single depth
                dayArrays.depths = [0]; // Assume surface
            } else {
                throw new Error(`Unsupported binary version: ${version}`);
            }

            console.log(`   Loaded ${dateKey}: ${(arrayBuffer.byteLength / (1024**2)).toFixed(1)}MB in ${loadTime.toFixed(0)}ms`);
            console.log(`   Grid: ${dayArrays.nLat}x${dayArrays.nLon}x${dayArrays.nDepth}`);

            // Store grid info on first load
            if (!this.gridInfo) {
                this.gridInfo = {
                    nLat: dayArrays.nLat,
                    nLon: dayArrays.nLon,
                    nDepth: dayArrays.nDepth,
                    totalCells: dayArrays.totalCells,
                    totalDataPoints: dayArrays.totalDataPoints,
                    depths: dayArrays.depths || this.metadata.depths,
                    bytesPerArray: dayArrays.totalCells * 4
                };

                // Build spatial index using surface layer (index 0)
                const surfaceLonArray = new Float32Array(arrayBuffer, 28, dayArrays.totalCells);
                const surfaceLatArray = new Float32Array(arrayBuffer, 28 + (dayArrays.totalCells * 4), dayArrays.totalCells);
                this.buildSpatialIndex(surfaceLonArray, surfaceLatArray, dayArrays.nLat, dayArrays.nLon);
            }

            dayArrays.arrayBuffer = arrayBuffer; // Keep reference to prevent GC
            dayArrays.loadTime = loadTime;

            return dayArrays;

        } catch (error) {
            console.error(`❌ Failed to load day ${dateKey}:`, error);
            throw error;
        }
    }

    _parseVersion4(view, arrayBuffer, dateKey) {
        const nLat = view.getInt32(4, true);
        const nLon = view.getInt32(8, true);
        const nDepth = view.getInt32(12, true);
        const fileYear = view.getInt32(16, true);
        const fileMonth = view.getInt32(20, true);
        const fileDay = view.getInt32(24, true);

        const totalCells = nLat * nLon;
        const totalDataPoints = totalCells * nDepth;

        const headerSize = 28; // 7 ints = 28 bytes for version 4
        const dataStart = headerSize;

        return {
            lonArray: new Float32Array(arrayBuffer, dataStart, totalCells),
            latArray: new Float32Array(arrayBuffer, dataStart + (totalCells * 4), totalCells),
            uArray: new Float32Array(arrayBuffer, dataStart + (2 * totalCells * 4), totalDataPoints),
            vArray: new Float32Array(arrayBuffer, dataStart + (2 * totalCells * 4 + totalDataPoints * 4), totalDataPoints),
            nLat,
            nLon,
            nDepth,
            totalCells,
            totalDataPoints,
            year: fileYear,
            month: fileMonth,
            day: fileDay,
            dateKey,
            depths: this.metadata?.depths || [0, 50, 100, 200, 500, 1000]
        };
    }

    _parseVersion3(view, arrayBuffer, dateKey) {
        const nLat = view.getInt32(4, true);
        const nLon = view.getInt32(8, true);
        const fileYear = view.getInt32(12, true);
        const fileMonth = view.getInt32(16, true);
        const fileDay = view.getInt32(20, true);

        const totalCells = nLat * nLon;

        const headerSize = 24; // 6 ints = 24 bytes for version 3
        const dataStart = headerSize;

        return {
            lonArray: new Float32Array(arrayBuffer, dataStart, totalCells),
            latArray: new Float32Array(arrayBuffer, dataStart + (totalCells * 4), totalCells),
            uArray: new Float32Array(arrayBuffer, dataStart + (2 * totalCells * 4), totalCells),
            vArray: new Float32Array(arrayBuffer, dataStart + (3 * totalCells * 4), totalCells),
            nLat,
            nLon,
            nDepth: 1,
            totalCells,
            totalDataPoints: totalCells,
            year: fileYear,
            month: fileMonth,
            day: fileDay,
            dateKey
        };
    }

    // ==================== DEPTH MANAGEMENT ====================

    getDepthIndex(targetDepth) {
        if (!this.metadata?.depths || this.metadata.depths.length === 0) {
            console.warn('No depths metadata available, using surface');
            return 0;
        }

        const depths = this.metadata.depths;

        // If target depth is exactly in array
        const exactIndex = depths.indexOf(targetDepth);
        if (exactIndex !== -1) return exactIndex;

        // Find closest depth
        let closestIndex = 0;
        let minDiff = Math.abs(targetDepth - depths[0]);

        for (let i = 1; i < depths.length; i++) {
            const diff = Math.abs(targetDepth - depths[i]);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        // Warn if interpolation might be needed
        if (minDiff > 0) {
            console.log(`⚠️ Depth ${targetDepth}m not available, using ${depths[closestIndex]}m (diff: ${minDiff}m)`);
        }

        return closestIndex;
    }

    getDepthValue(depthIndex) {
        if (!this.metadata?.depths || depthIndex < 0 || depthIndex >= this.metadata.depths.length) {
            return 0;
        }
        return this.metadata.depths[depthIndex];
    }

    // ==================== DATE/DAY CONVERSION ====================

    simulationDayToDate(simulationDay) {
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

    // ==================== CORE 3D LOOKUP ====================

    async getVelocityAt(lon, lat, depth = null, simulationDay = 0) {
        // Use default depth if not specified
        const targetDepth = depth !== null ? depth : this.defaultDepth;
        const depthIndex = this.getDepthIndex(targetDepth);

        // Convert simulation day to date
        const dateInfo = this.simulationDayToDate(simulationDay);

        // Ensure day is loaded
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        // Find closest grid cell
        const cell = this.findNearestCell(lon, lat, dayData);

        if (!cell) {
            return {
                u: 0,
                v: 0,
                found: false,
                depth: targetDepth,
                actualDepth: this.getDepthValue(depthIndex)
            };
        }

        // Calculate index with depth dimension
        const idx = (depthIndex * dayData.totalCells) + cell.idx;

        // Check bounds
        if (idx >= dayData.totalDataPoints) {
            console.warn(`Index out of bounds: ${idx} >= ${dayData.totalDataPoints}`);
            return { u: 0, v: 0, found: false };
        }

        // DIRECT array access
        const u = dayData.uArray[idx];
        const v = dayData.vArray[idx];
        const isOcean = !isNaN(u) && !isNaN(v) && Math.abs(u) < 1000 && Math.abs(v) < 1000;

        return {
            u: isOcean ? u : 0,
            v: isOcean ? v : 0,
            found: isOcean,
            cached: false,
            depth: targetDepth,
            actualDepth: this.getDepthValue(depthIndex),
            depthIndex,
            gridCell: [cell.i, cell.j],
            distance: cell.distance,
            date: dateInfo.dateKey
        };
    }

    async getVelocitiesAtMultiple(positions, depth = null, simulationDay = 0) {
        // Use default depth if not specified
        const targetDepth = depth !== null ? depth : this.defaultDepth;
        const depthIndex = this.getDepthIndex(targetDepth);

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
                const idx = (depthIndex * dayData.totalCells) + cell.idx;

                if (idx < dayData.totalDataPoints) {
                    const u = dayData.uArray[idx];
                    const v = dayData.vArray[idx];
                    const isOcean = !isNaN(u) && !isNaN(v) && Math.abs(u) < 1000 && Math.abs(v) < 1000;

                    results[k] = {
                        u: isOcean ? u : 0,
                        v: isOcean ? v : 0,
                        found: isOcean,
                        depth: targetDepth,
                        actualDepth: this.getDepthValue(depthIndex),
                        depthIndex,
                        gridCell: [cell.i, cell.j],
                        date: dateInfo.dateKey
                    };
                } else {
                    results[k] = {
                        u: 0,
                        v: 0,
                        found: false,
                        depth: targetDepth,
                        actualDepth: this.getDepthValue(depthIndex),
                        date: dateInfo.dateKey
                    };
                }
            } else {
                results[k] = {
                    u: 0,
                    v: 0,
                    found: false,
                    depth: targetDepth,
                    actualDepth: this.getDepthValue(depthIndex),
                    date: dateInfo.dateKey
                };
            }
        }

        return results;
    }

    // ==================== VERTICAL PROFILE ====================

    async getVerticalProfile(lon, lat, simulationDay = 0) {
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
        const cell = this.findNearestCell(lon, lat, dayData);

        if (!cell) return null;

        const profile = {
            lon: dayData.lonArray[cell.idx],
            lat: dayData.latArray[cell.idx],
            depths: [],
            uValues: [],
            vValues: [],
            speeds: [],
            directions: [],
            date: dateInfo.dateKey
        };

        for (let depthIndex = 0; depthIndex < dayData.nDepth; depthIndex++) {
            const idx = (depthIndex * dayData.totalCells) + cell.idx;
            const u = dayData.uArray[idx];
            const v = dayData.vArray[idx];

            if (!isNaN(u) && !isNaN(v)) {
                const depth = this.getDepthValue(depthIndex);
                const speed = Math.sqrt(u * u + v * v);
                const direction = Math.atan2(v, u) * (180 / Math.PI); // Degrees from east

                profile.depths.push(depth);
                profile.uValues.push(u);
                profile.vValues.push(v);
                profile.speeds.push(speed);
                profile.directions.push(direction);
            }
        }

        return profile;
    }

    // ==================== SPATIAL INDEX ====================

    buildSpatialIndex(lonArray, latArray, nLat, nLon) {
        console.log('🗺️ Building 3D spatial index...');

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
        if (!this.spatialGrid || !this.gridBounds) {
            console.warn('Spatial index not built, performing linear search');
            return this.findNearestCellLinear(lon, lat, dayData);
        }

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

    findNearestCellLinear(lon, lat, dayData) {
        const { nLat, nLon, lonArray, latArray } = dayData;

        let bestDist = Infinity;
        let bestCell = null;

        for (let i = 0; i < nLat; i += 10) {
            for (let j = 0; j < nLon; j += 10) {
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

        return bestCell;
    }

    // ==================== MEMORY MANAGEMENT ====================

    setMaxDaysInMemory(maxDays = 3) {
        if (this.loadedDays.size > maxDays) {
            const keys = Array.from(this.loadedDays.keys());
            const toRemove = keys.slice(0, keys.length - maxDays);

            toRemove.forEach(dateKey => {
                if (dateKey !== this.activeDayKey) {
                    this.loadedDays.delete(dateKey);
                }
            });

            console.log(`🗑️ Kept ${maxDays} days in memory (3D data is larger)`);
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
            if (targetDay >= 0 && targetDay < (this.metadata?.days.length || 0)) {
                daysToPreload.push(targetDay);
            }
        }

        console.log(`🔍 Preloading 3D days: ${daysToPreload.join(', ')}`);
        await Promise.all(daysToPreload.map(day => {
            const dateInfo = this.simulationDayToDate(day);
            return this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
        }));
    }

    // ==================== LAND MASK METHODS (3D) ====================

    async getLandMask(depth = 0, simulationDay = 0) {
        const depthIndex = this.getDepthIndex(depth);
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        const { nLat, nLon } = dayData;
        const mask = new Array(nLat).fill().map(() => new Array(nLon).fill(false));

        for (let i = 0; i < nLat; i++) {
            for (let j = 0; j < nLon; j++) {
                const idx = (depthIndex * dayData.totalCells) + (i * nLon + j);
                mask[i][j] = !isNaN(dayData.uArray[idx]);
            }
        }

        return {
            mask,
            nLat,
            nLon,
            depth: depth,
            actualDepth: this.getDepthValue(depthIndex),
            oceanCount: mask.flat().filter(cell => cell).length,
            landCount: mask.flat().filter(cell => !cell).length,
            date: dateInfo.dateKey
        };
    }

    async isOcean(lon, lat, depth = 0, simulationDay = 0) {
        try {
            const dateInfo = this.simulationDayToDate(simulationDay);
            const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
            const cell = this.findNearestCell(lon, lat, dayData);

            if (!cell) return false;

            const depthIndex = this.getDepthIndex(depth);
            const idx = (depthIndex * dayData.totalCells) + cell.idx;
            const u = dayData.uArray[idx];

            // 🟢 FIX: -9999 is NOT ocean
            if (Math.abs(u) > 1000) return false;

            return !isNaN(u);

        } catch (error) {
            console.warn('Land mask check failed:', error);
            return false;
        }
    }

    async findNearestOceanCell(lon, lat, depth = 0, simulationDay = 0, maxSearchRadius = 10) {
        const depthIndex = this.getDepthIndex(depth);
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);
        const { nLat, nLon, uArray, lonArray, latArray } = dayData;

        const exactCell = this.findNearestCell(lon, lat, dayData);

        // Check if exact cell is ocean at specified depth
        if (exactCell) {
            const exactIdx = (depthIndex * dayData.totalCells) + exactCell.idx;
            if (!isNaN(uArray[exactIdx])) {
                return {
                    ...exactCell,
                    lon: lonArray[exactCell.idx],
                    lat: latArray[exactCell.idx],
                    depth: depth,
                    actualDepth: this.getDepthValue(depthIndex)
                };
            }
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
                        const idx = (depthIndex * dayData.totalCells) + (i * nLon + j);
                        if (!isNaN(uArray[idx])) {
                            return {
                                i, j,
                                idx: i * nLon + j,
                                lon: lonArray[i * nLon + j],
                                lat: latArray[i * nLon + j],
                                depth: depth,
                                actualDepth: this.getDepthValue(depthIndex)
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    // ==================== STATS & INFO ====================

    getStats() {
        return {
            loadedDays: this.loadedDays.size,
            totalDays: this.metadata?.days.length || 0,
            depths: this.metadata?.depths || [],
            gridSize: this.gridInfo ?
                `${this.gridInfo.nLat}x${this.gridInfo.nLon}x${this.gridInfo.nDepth}` : 'N/A',
            memoryUsage: this.calculateMemoryUsage(),
            activeDay: this.activeDayKey,
            defaultDepth: this.defaultDepth,
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
            memoryUsage: this.calculateMemoryUsage(),
            depthsAvailable: this.metadata.depths.length
        };
    }

    // ==================== SETTINGS ====================

    setDefaultDepth(depth) {
        this.defaultDepth = depth;
        console.log(`📏 Default depth set to ${depth}m`);
    }

    getAvailableDepths() {
        return this.metadata?.depths || [];
    }

    // ==================== BATCH OPERATIONS ====================

    async getCurrentsForDepthLayer(depth, simulationDay = 0) {
        const depthIndex = this.getDepthIndex(depth);
        const dateInfo = this.simulationDayToDate(simulationDay);
        const dayData = await this.loadDayByDate(dateInfo.year, dateInfo.month, dateInfo.day);

        const { nLat, nLon, totalCells } = dayData;
        const uLayer = new Float32Array(nLat * nLon);
        const vLayer = new Float32Array(nLat * nLon);

        const startIdx = depthIndex * totalCells;

        for (let i = 0; i < totalCells; i++) {
            uLayer[i] = dayData.uArray[startIdx + i];
            vLayer[i] = dayData.vArray[startIdx + i];
        }

        return {
            u: uLayer,
            v: vLayer,
            lon: dayData.lonArray,
            lat: dayData.latArray,
            nLat,
            nLon,
            depth: depth,
            actualDepth: this.getDepthValue(depthIndex),
            date: dateInfo.dateKey
        };
    }
}

// Global instance
window.StreamingHYCOMLoader_3D = StreamingHYCOMLoader_3D;
window.streamingHycomLoader3D = new StreamingHYCOMLoader_3D();

// Auto-initialize
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🌊 3D HYCOM Loader initializing...');
    try {
        await window.streamingHycomLoader3D.init();
        console.log('✅ 3D HYCOM Loader ready');
        console.log('📊 Stats:', window.streamingHycomLoader3D.getStats());
    } catch (error) {
        console.error('❌ 3D loader failed:', error);
    }
});

console.log('=== 3D HYCOM Loader loaded ===');