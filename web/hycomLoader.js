// streamingHYCOMLoader_3D.js - 3D MULTI-DEPTH STREAMING with KD-TREE ACCELERATION
console.log('=== Streaming HYCOM Loader 3D (KD-Tree Accelerated) ===');

class StreamingHYCOMLoader_3D {
    constructor() {
        this.metadata = null;
        this.gridInfo = null;
        this.loadedDays = new Map();
        this.loadingPromises = new Map();
        this.activeDayKey = null;
        this.baseDate = new Date('2011-01-01T00:00:00Z');
        this.defaultDepth = 0;
        this.maxDaysInMemory = 2;
        this.minLon = 100;
        this.maxLon = 260; 
        this.minLat = 0;
        this.maxLat = 65;
        this.lonStep = 1/12;  // 0.08333
        this.latStep = 1/12;
        this.nLon = 1921;
        this.nLat = 781;



        console.log("🌊 3D HYCOM Loader initialized");
    }


    findNearestCell(lon, lat) {
        const lon_idx = Math.round((lon - this.minLon) / this.lonStep);
        const lat_idx = Math.round((lat - this.minLat) / this.latStep);
        
        // Clamp to valid range
        const lon_idx_clamped = Math.max(0, Math.min(lon_idx, this.nLon - 1));
        const lat_idx_clamped = Math.max(0, Math.min(lat_idx, this.nLat - 1));
        
        return {
            lon_idx: lon_idx_clamped,
            lat_idx: lat_idx_clamped,
            idx: lat_idx_clamped * this.nLon + lon_idx_clamped,  // flattened index
            distance: 0  // Not needed for GLORYS, but expected
        };
    }

    // ==================== INIT ====================

    async init() {
        try {
            await this.loadMetadata();
            await this.loadDayByOffset(0);
            console.log('✅ 3D loader ready');
            return true;
        } catch (error) {
            console.error('❌ Init failed:', error);
            return false;
        }
    }

    async loadMetadata() {
        const response = await fetch('../data/glorys_3yr_bin/glorys_metadata.json');
        this.metadata = await response.json();

        this.daysByOffset = {};
        this.daysByDate = {};

        this.metadata.days.forEach(day => {
            this.daysByOffset[day.day_offset] = day;
            const key = `${day.year}-${String(day.month).padStart(2,'0')}-${String(day.day).padStart(2,'0')}`;
            this.daysByDate[key] = day;
        });

        console.log(`✅ Loaded ${this.metadata.days.length} days, depths: ${this.metadata.depths.join(', ')}m`);
    }

    // ==================== DAY LOADING ====================

    async loadDayByOffset(offset) {
        const day = this.daysByOffset[offset];
        return day ? this.loadDayByDate(day.year, day.month, day.day) : null;
    }

    async loadDayByDate(year, month, day) {

        const dateKey = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

        if (this.loadingPromises.has(dateKey)) return this.loadingPromises.get(dateKey);
        if (this.loadedDays.has(dateKey)) {
            this.activeDayKey = dateKey;
            return this.loadedDays.get(dateKey);
        }

        const promise = this._loadDay(dateKey, year, month, day);
        this.loadingPromises.set(dateKey, promise);

        try {
            const data = await promise;
            this.loadedDays.set(dateKey, data);
            this.activeDayKey = dateKey;


            this._enforceMemoryLimit();
            return data;
        } finally {
            this.loadingPromises.delete(dateKey);
        }
    }
    halfToFloat(h) {
        let s = (h & 0x8000) >> 15;
        let e = (h & 0x7C00) >> 10;
        let f = h & 0x03FF;
        
        if(e == 0) {
            return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
        } else if(e == 0x1F) {
            return f ? NaN : (s ? -Infinity : Infinity);
        } else {
            return (s ? -1 : 1) * Math.pow(2, e-15) * (1 + f / Math.pow(2, 10));
        }
    }

    async _loadDay(dateKey, year, month, day) {
        const path = `../data/glorys_3yr_bin/glorys_${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}.bin`;

        const start = performance.now();
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);
        const version = view.getInt32(0, true);

        if (version !== 2) throw new Error(`Unsupported version: ${version}`);

        const nLat = view.getInt32(4, true);
        const nLon = view.getInt32(8, true);
        const nDepth = view.getInt32(12, true);
        const fileYear = view.getInt32(16, true);
        const fileMonth = view.getInt32(20, true);
        const fileDay = view.getInt32(24, true);

        const totalCells = nLat * nLon;
        const totalPoints = totalCells * nDepth;
        const headerSize = 28;

        const lon = new Float32Array(totalCells);
        const lat = new Float32Array(totalCells);
        const u = new Float32Array(totalPoints);
        const v = new Float32Array(totalPoints);

        const lonSize = totalCells * 4;        // bytes for lon (float32)
        const latSize = totalCells * 4;        // bytes for lat (float32)
        const uSize = totalPoints * 2;         // bytes for u (float16)

        // Read lon (float32)
        lon.set(new Float32Array(buffer, headerSize, totalCells));
        
        // Read lat (float32) - after lon
        lat.set(new Float32Array(buffer, headerSize + lonSize, totalCells));
        
        // Read u (float16) - after lat
        const u16 = new Uint16Array(buffer, headerSize + lonSize + latSize, totalPoints);
        for (let i = 0; i < totalPoints; i++) {
            u[i] = this.halfToFloat(u16[i]);
        }
        
        // Read v (float16) - after u
        const v16 = new Uint16Array(buffer, headerSize + lonSize + latSize + uSize, totalPoints);
        for (let i = 0; i < totalPoints; i++) {
            v[i] = this.halfToFloat(v16[i]);
        }

        console.log(`  Loaded ${dateKey} in ${(performance.now()-start).toFixed(0)}ms`);

        return {
            lonArray: lon, latArray: lat, uArray: u, vArray: v,
            nLat, nLon, nDepth, totalCells, totalDataPoints: totalPoints,
            year: fileYear, month: fileMonth, day: fileDay,
            depths: this.metadata?.depths || [0,50,100,200,500,1000],
            fileSize: buffer.byteLength
        };
    }


    _enforceMemoryLimit() {
        if (this.loadedDays.size <= this.maxDaysInMemory) return;

        const keys = Array.from(this.loadedDays.keys()).sort();
        const toRemove = keys.slice(0, keys.length - this.maxDaysInMemory);

        toRemove.forEach(key => {
            if (key === this.activeDayKey) return;
            const data = this.loadedDays.get(key);
            if (data) {
                data.lonArray = null;
                data.latArray = null;
                data.uArray = null;
                data.vArray = null;
            }
            this.loadedDays.delete(key);
        });
    }

    // ==================== DEPTH ====================

    getDepthIndex(targetDepth) {
        const depths = this.metadata?.depths || [0,50,100,200,500,1000];
        let best = 0, bestDiff = Math.abs(targetDepth - depths[0]);

        for (let i = 1; i < depths.length; i++) {
            const diff = Math.abs(targetDepth - depths[i]);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = i;
            }
        }
        return best;
    }

    getDepthValue(idx) {
        return this.metadata?.depths?.[idx] || 0;
    }

    // ==================== DATE ====================

    simulationDayToDate(day) {
        const d = new Date(this.baseDate.getTime() + day * 86400000);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            dateKey: d.toISOString().split('T')[0]
        };
    }

    // ==================== VELOCITY LOOKUPS ====================

    async getVelocityAt(lon, lat, depth = null, simDay = 0) {

        const targetDepth = depth ?? this.defaultDepth;
        const depthIdx = this.getDepthIndex(targetDepth);
        const date = this.simulationDayToDate(simDay);
        const dayData = await this.loadDayByDate(date.year, date.month, date.day);
        const cell = this.findNearestCell(lon, lat);

        if (!cell) return { u:0, v:0, found:false, depth:targetDepth };

        const idx = depthIdx * dayData.totalCells + cell.idx;
        if (idx >= dayData.totalDataPoints) return { u:0, v:0, found:false };

        const u = dayData.uArray[idx];
        const v = dayData.vArray[idx];
        const isOcean = !isNaN(u) && Math.abs(u) < 1000;

        return {
            u: isOcean ? u : 0,
            v: isOcean ? v : 0,
            found: isOcean,
            depth: targetDepth,
            actualDepth: this.getDepthValue(depthIdx),
            distance: cell.distance
        };
    }

    async getVelocitiesAtMultiple(positions, depth = null, simDay = 0) {

        const targetDepth = depth ?? this.defaultDepth;
        const depthIdx = this.getDepthIndex(targetDepth);
        const date = this.simulationDayToDate(simDay);
        const dayData = await this.loadDayByDate(date.year, date.month, date.day);
        const baseIdx = depthIdx * dayData.totalCells;
        const results = new Array(positions.length);

        for (let i = 0; i < positions.length; i++) {
            const { lon, lat } = positions[i];
            const cell = this.findNearestCell(lon, lat);

            if (!cell) {
                results[i] = { u:0, v:0, found:false };
                continue;
            }

            const idx = baseIdx + cell.idx;
            if (idx >= dayData.totalDataPoints) {
                results[i] = { u:0, v:0, found:false };
                continue;
            }

            const u = dayData.uArray[idx];
            const v = dayData.vArray[idx];
            const isOcean = !isNaN(u) && Math.abs(u) < 1000;

            results[i] = {
                u: isOcean ? u : 0,
                v: isOcean ? v : 0,
                found: isOcean,
                distance: cell.distance
            };
        }

        return results;
    }

    // ==================== OCEAN CHECKS ====================

    async isOcean(lon, lat, depth = 0, simDay = 0) {

        try {
            const vel = await this.getVelocityAt(lon, lat, depth, simDay);
            return vel.found;
        } catch {
            return false;
        }
    }

    // ==================== SETTINGS ====================

    setDefaultDepth(depth) {
        this.defaultDepth = depth;
    }

    getAvailableDepths() {
        return this.metadata?.depths || [];
    }
}

// ==================== GLOBAL ====================

window.StreamingHYCOMLoader_3D = StreamingHYCOMLoader_3D;
window.streamingHycomLoader3D = new StreamingHYCOMLoader_3D();

// Auto-start
window.addEventListener('DOMContentLoaded', () => {
    window.streamingHycomLoader3D.init().catch(console.error);
});

console.log('=== HYCOM Loader ready ===');