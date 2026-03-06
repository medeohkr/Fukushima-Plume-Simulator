// PROTEUS Particle Engine - Pacific Radionuclide Oceanic Transport Engine & Universal Simulator
console.log('=== PROTEUS Particle Engine Loading ===');

// ==================== TRACER LIBRARY ====================
// Focused on radionuclides only - oil and other tracers removed

const TracerLibrary = {
    cs137: {
        id: 'cs137',
        name: 'Cesium-137',
        type: 'radionuclide',
        halfLife: 11000, // days (30.1 years)
        units: 'Bq',
        defaultTotal: 16.2e15, // 16.2 PBq
        color: '#ff6b6b',
        behavior: {
            diffusivityScale: 1.0,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 10000,
            sigmaV: 50
        }
    },
    cs134: {
        id: 'cs134',
        name: 'Cesium-134',
        type: 'radionuclide',
        halfLife: 750,
        units: 'Bq',
        defaultTotal: 1.8e15,
        color: '#ff9f6b',
        behavior: {
            diffusivityScale: 1.0,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 10000,
            sigmaV: 50
        }
    },
    i131: {
        id: 'i131',
        name: 'Iodine-131',
        type: 'radionuclide',
        halfLife: 8,
        units: 'Bq',
        defaultTotal: 10.0e15,
        color: '#9f6bff',
        behavior: {
            diffusivityScale: 1.1,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 12000,
            sigmaV: 60
        }
    },
    sr90: {
        id: 'sr90',
        name: 'Strontium-90',
        type: 'radionuclide',
        halfLife: 10500,
        units: 'Bq',
        defaultTotal: 0.2e15,
        color: '#6b9fff',
        behavior: {
            diffusivityScale: 0.9,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 9000,
            sigmaV: 45
        }
    },
    h3: {
        id: 'h3',
        name: 'Tritium',
        type: 'radionuclide',
        halfLife: 4500,
        units: 'Bq',
        defaultTotal: 1.0e15,
        color: '#6bff9f',
        behavior: {
            diffusivityScale: 1.1,
            settlingVelocity: 0,
            decay: true,
            sigmaH: 11000,
            sigmaV: 55
        }
    }
};

// ==================== RELEASE PHASE MANAGER ====================

class ReleasePhase {
    constructor(start = 0, end = 30, total = 10, unit = 'PBq') {
        this.start = start;
        this.end = end;
        this.total = total;
        this.unit = unit;
    }

    getDuration() {
        return this.end - this.start;
    }

    getRate() {
        return this.total / this.getDuration();
    }
}

class ReleaseManager {
    constructor(tracerId = 'cs137') {
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.phases = [];
        this.addDefaultPhase();
    }

    addDefaultPhase() {
        const defaultTotal = this.tracer.defaultTotal / 1e9; // Convert to GBq
        this.phases = [new ReleasePhase(0, 30, defaultTotal, 'PBq')];
    }

    convertToBaseUnit(amount, fromUnit) {
        const conversions = {
            'GBq': 1, 'TBq': 1000, 'PBq': 1e6
        };
        return amount * (conversions[fromUnit] || 1);
    }

    getRateAtDay(day) {
        for (const phase of this.phases) {
            if (day >= phase.start && day <= phase.end) {
                return phase.getRate();
            }
        }
        return 0;
    }

    getTotalRelease() {
        let total = 0;
        this.phases.forEach(phase => {
            total += phase.total * this.convertToBaseUnit(1, phase.unit);
        });
        return total;
    }

    getParticleActivity(totalParticles) {
        return this.getTotalRelease() / totalParticles;
    }
}

// ==================== PARTICLE ENGINE 3D ====================

class ParticleEngine3D {
    constructor(numParticles = 10000, tracerId = 'cs137', startLocation = null) {
        console.log('🚀 Initializing PROTEUS Particle Engine');

        this.hycomLoader = window.streamingHycomLoader3D;
        this.ekeLoader = window.streamingEkeLoader;

        // Coordinate system
        if (startLocation) {
            this.REFERENCE_LON = startLocation.lon;
            this.REFERENCE_LAT = startLocation.lat;
        } else {
            this.REFERENCE_LON = 142.03;
            this.REFERENCE_LAT = 37.42;
        }

        this.LON_SCALE = 88.8;
        this.LAT_SCALE = 111.0;

        // Tracer configuration
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.releaseManager = new ReleaseManager(tracerId);
        this.particleCount = numParticles;
        this.calculateParticleCalibration();

        // Physics settings
        this.landSettings = {
            enabled: true,
            maxLandSearchRadius: 10.0,
            revertOnLand: true
        };

        this.rk4Enabled = false;
        this.rk4Settings = {
            enabled: false,
            timeStepSafety: 0.5,
            maxStepsPerDay: 100,
            adaptiveStepSize: true,
            minStepSize: 0.01,
            maxStepSize: 0.25
        };

        this.params = {
            diffusivityScale: 1.0,
            simulationSpeed: 1.0,
            verticalMixing: true,
            ekmanPumping: 5e-6,
            convectiveMixing: 2e-6
        };

        this.kzProfile = {
            mixedLayer: { depth: 50, kz: 0.01 },
            upperOcean: { depth: 200, kz: 0.0001 },
            deepOcean: { depth: 1000, kz: 0.00005 }
        };

        // Simulation state
        this.isRunning = false;
        this.lastUpdateTime = Date.now();
        this.simulationStartTime = new Date('2011-031T00:00:00Z');
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.particleFraction = 0;

        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0,
            particlesOnLand: 0,
            maxDepthReached: 0,
            maxConcentration: 0
        };

        this.particlePool = [];
        this.initializeParticlePool(numParticles);
    }

    calculateParticleCalibration() {
        const totalRelease = this.releaseManager.getTotalRelease();
        this.UNITS_PER_PARTICLE = totalRelease > 0 ?
            this.releaseManager.getParticleActivity(this.particleCount) : 1;
    }

    initializeParticlePool(numParticles) {
        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                tracerId: this.tracerId,
                x: 0, y: 0, depth: 0,
                concentration: 0,
                age: 0,
                mass: this.UNITS_PER_PARTICLE || 1.0,
                history: [],
                velocityU: 0, velocityV: 0
            });
        }
    }

    async init() {
        try {
            if (this.hycomLoader && !this.hycomLoader.metadata) await this.hycomLoader.init();
            if (this.ekeLoader && !this.ekeLoader.metadata) await this.ekeLoader.init();
            await this.hycomLoader.loadDayByOffset(0);
            return true;
        } catch (error) {
            console.error('Engine init failed:', error);
            return false;
        }
    }

    setReleaseLocation(lat, lon) {
        this.REFERENCE_LAT = lat;
        this.REFERENCE_LON = lon;
    }

    // ==================== SIMULATION CONTROL ====================

    startSimulation() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
        if (this.stats.totalReleased === 0) {
            this.currentSimulationTime = new Date(this.simulationStartTime);
            this.stats.simulationDays = 0;
        }
    }

    pauseSimulation() {
        if (!this.isRunning) return;
        this.isRunning = false;
    }

    resumeSimulation() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
    }

    resetSimulation() {
        this.isRunning = false;
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.stats = {
            totalReleased: 0, totalDecayed: 0, simulationDays: 0,
            activeParticles: 0, particlesOnLand: 0,
            maxDepthReached: 0, maxConcentration: 0
        };

        for (const p of this.particlePool) {
            p.active = false;
            p.x = 0; p.y = 0; p.depth = 0;
            p.age = 0;
            p.mass = this.UNITS_PER_PARTICLE || 1.0;
            p.concentration = 0;
            p.history = [];
            p.velocityU = 0; p.velocityV = 0;
        }
    }

    // ==================== PARTICLE RELEASE ====================

    async releaseParticles(count) {
        let released = 0;
        const RELEASE_CENTER = { lon: this.REFERENCE_LON, lat: this.REFERENCE_LAT };
        const SIGMA = 20.0 / this.LON_SCALE;

        // Get inactive particles
        const availableParticles = this.particlePool.filter(p => !p.active);

        for (const p of availableParticles) {
            if (released >= count) break;

            // Generate random position (no ocean checking!)
            const u1 = Math.random(), u2 = Math.random();
            const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

            const lon = RELEASE_CENTER.lon + z0 * SIGMA;
            const lat = RELEASE_CENTER.lat + z1 * SIGMA;

            // Clamp to reasonable bounds
            const clampedLon = Math.max(RELEASE_CENTER.lon - SIGMA * 3,
                                       Math.min(RELEASE_CENTER.lon + SIGMA * 3, lon));
            const clampedLat = Math.max(RELEASE_CENTER.lat - SIGMA * 3,
                                       Math.min(RELEASE_CENTER.lat + SIGMA * 3, lat));

            // Activate the particle
            p.x = (clampedLon - this.REFERENCE_LON) * this.LON_SCALE;
            p.y = (clampedLat - this.REFERENCE_LAT) * this.LAT_SCALE;
            p.depth = 0;
            p.active = true;
            p.age = 0;
            p.mass = this.UNITS_PER_PARTICLE || 1.0;
            p.tracerId = this.tracerId;
            p.concentration = this.calculateConcentration(p);
            p.releaseDay = this.stats.simulationDays;
            p.history = [{x: p.x, y: p.y, depth: p.depth}];

            released++;
        }

        this.stats.totalReleased += released;
        console.log(`🎯 Released ${released} particles at ${RELEASE_CENTER.lat}°N, ${RELEASE_CENTER.lon}°E`);
        return released;
    }

    // ==================== CONTINUOUS RELEASE ====================

    async executeContinuousRelease(deltaDays) {
        if (!this.isRunning) return;

        const currentSimDay = this.stats.simulationDays;

        let activePhase = null;
        for (const phase of this.releaseManager.phases) {
            if (currentSimDay >= phase.start && currentSimDay <= phase.end) {
                activePhase = phase;
                break;
            }
        }

        if (!activePhase) return;
        if (!this.UNITS_PER_PARTICLE || this.UNITS_PER_PARTICLE <= 0) return;

        let rateInBase = activePhase.getRate();
        if (activePhase.unit === 'PBq') rateInBase *= 1e6;
        if (activePhase.unit === 'TBq') rateInBase *= 1000;

        const particlesPerDay = rateInBase / this.UNITS_PER_PARTICLE;
        const increment = particlesPerDay * deltaDays;

        this.particleFraction += increment;

        const wholeParticles = Math.floor(this.particleFraction);
        if (wholeParticles >= 1) {
            this.particleFraction -= wholeParticles;
            await this.releaseParticles(wholeParticles);
        }
    }

    // ==================== LAND INTERACTION ====================

    async checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay) {
        if (!this.landSettings.enabled || !this.hycomLoader) return false;

        const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
        const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
        const depthMeters = p.depth * 1000;

        try {
            const isOcean = await this.hycomLoader.isOcean(lon, lat, depthMeters, currentSimDay);

            if (!isOcean) {
                p.x = prevX; p.y = prevY; p.depth = prevDepth;

                const oceanCell = await this.hycomLoader.findNearestOceanCell(
                    lon, lat, depthMeters, currentSimDay, this.landSettings.maxLandSearchRadius
                );

                if (oceanCell) {
                    const targetX = (oceanCell.lon - this.REFERENCE_LON) * this.LON_SCALE;
                    const targetY = (oceanCell.lat - this.REFERENCE_LAT) * this.LAT_SCALE;
                    const dx = targetX - prevX, dy = targetY - prevY;
                    const dist = Math.sqrt(dx*dx + dy*dy);

                    if (dist > 0) {
                        p.x = prevX + dx * 0.5;
                        p.y = prevY + dy * 0.5;
                    }
                }
                return true;
            }
            return false;
        } catch {
            p.x = prevX; p.y = prevY; p.depth = prevDepth;
            return true;
        }
    }

    async _checkPathToOcean(startX, startY, endX, endY, depth, currentSimDay, steps = 5) {
        const stepX = (endX - startX) / steps;
        const stepY = (endY - startY) / steps;

        for (let s = 1; s <= steps; s++) {
            const testX = startX + stepX * s;
            const testY = startY + stepY * s;
            const testLon = this.REFERENCE_LON + (testX / this.LON_SCALE);
            const testLat = this.REFERENCE_LAT + (testY / this.LAT_SCALE);
            const isOcean = await this.hycomLoader.isOcean(testLon, testLat, depth * 1000, currentSimDay);

            if (!isOcean) {
                return {
                    safe: false,
                    lastValidX: startX + stepX * (s - 1),
                    lastValidY: startY + stepY * (s - 1)
                };
            }
        }
        return { safe: true, lastValidX: endX, lastValidY: endY };
    }

    // ==================== DIFFUSION ====================

    async applyDiffusion(p, deltaDays, currentSimDay) {
        try {
            const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
            const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
            
            // DEBUG: Log the inputs
            console.log({
                lon, lat,
                currentSimDay,
                p_x: p.x,
                p_y: p.y
            });
            
            const ekeResult = await this.ekeLoader.getDiffusivityAt(lon, lat, currentSimDay);
            
            // DEBUG: What came back?
            console.log('ekeResult:', ekeResult);
            
            let K_m2_s = ekeResult.found ?
                ekeResult.K * this.params.diffusivityScale * (this.tracer.behavior.diffusivityScale || 1.0) :
                20 * this.params.diffusivityScale;
            
            // DEBUG: Calculated K
            console.log('K_m2_s:', K_m2_s, 'from:', {
                found: ekeResult.found,
                eke_K: ekeResult.K,
                diffusivityScale: this.params.diffusivityScale,
                tracerScale: this.tracer.behavior.diffusivityScale
            });
            
            const stepScale_km = Math.sqrt(2 * K_m2_s * deltaDays * 86400) / 1000;
            
            // DEBUG: Step calculation
            console.log('stepScale_km:', stepScale_km, 'from:', {
                K: K_m2_s,
                deltaDays,
                seconds: deltaDays * 86400,
                sqrt_arg: 2 * K_m2_s * deltaDays * 86400
            });
            
            p.x += stepScale_km * this.gaussianRandom();
            p.y += stepScale_km * this.gaussianRandom();
            
        } catch (e) {
            console.error('Diffusion error:', e);
        }
    }

    // ==================== VERTICAL MOTION ====================

    applyVerticalMotion(p, dtSeconds) {
        const settling = this.tracer.behavior.settlingVelocity || 0;
        const depthM = p.depth * 1000;
        const kz = this.getVerticalDiffusivity(depthM);

        const randomDz = Math.sqrt(2 * kz * dtSeconds) * this.gaussianRandom();
        const settlingDz = settling * dtSeconds / 86400;

        let deterministicDz = this.params.ekmanPumping * dtSeconds;
        const dayOfYear = this.getDayOfYear();
        if ((dayOfYear < 90 || dayOfYear > 335) && depthM < 100) {
            deterministicDz += this.params.convectiveMixing * dtSeconds;
        }

        p.depth += (randomDz + settlingDz + deterministicDz) / 1000;
        p.depth = Math.max(0, Math.min(p.depth, 1.0));

        const currentDepthM = p.depth * 1000;
        if (currentDepthM > this.stats.maxDepthReached) {
            this.stats.maxDepthReached = currentDepthM;
        }
    }

    getVerticalDiffusivity(depthMeters) {
        if (depthMeters < this.kzProfile.mixedLayer.depth) return this.kzProfile.mixedLayer.kz;
        if (depthMeters < this.kzProfile.upperOcean.depth) return this.kzProfile.upperOcean.kz;
        return this.kzProfile.deepOcean.kz;
    }

    // ==================== CONCENTRATION CALCULATIONS ====================

    calculateConcentration(p) {
        if (!p.tracerId) return 0;

        const tracer = TracerLibrary[p.tracerId] || this.tracer;
        const sigmaH = tracer.behavior.sigmaH || 10000;
        const sigmaV = tracer.behavior.sigmaV || 50;
        const volume = Math.pow(2 * Math.PI, 1.5) * sigmaH * sigmaH * sigmaV;

        let mass = p.mass;
        if (tracer.behavior.decay && tracer.halfLife) {
            mass *= Math.pow(0.5, p.age / tracer.halfLife);
        }

        return mass / Math.max(volume, 1e9);
    }

    // ==================== MAIN UPDATE LOOP ====================

    async update(forcedDeltaDays = null) {
        if (!this.isRunning) return;

        const deltaDays = forcedDeltaDays !== null ? forcedDeltaDays :
                         ((Date.now() - this.lastUpdateTime) / 1000) * this.params.simulationSpeed;

        this.lastUpdateTime = Date.now();

        // Release, move, THEN increment
        this.executeContinuousRelease(deltaDays);
        await this.updateParticles(deltaDays);
        this.stats.simulationDays += deltaDays; // Only increment ONCE
    }

    async updateParticles(deltaDays) {
        if (!this.isRunning) return;
        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        this.stats.particlesOnLand = 0;
        const currentSimDay = this.stats.simulationDays;
        const dtSeconds = deltaDays * 86400;

        const depthGroups = this.groupParticlesByDepth(activeParticles);

        for (const [depthStr, particles] of Object.entries(depthGroups)) {
            const targetDepth = parseFloat(depthStr);
            const velocities = await this.getVelocitiesForGroup(particles, targetDepth, currentSimDay);

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                const velocity = velocities[i];
                const prevX = p.x, prevY = p.y, prevDepth = p.depth;

                // Advection
                if (this.rk4Enabled && this.rk4Settings.enabled) {
                    const rk4Result = await this.rk4Integrate(p, deltaDays, currentSimDay);
                    const pathCheck = await this._checkPathToOcean(
                        prevX, prevY, rk4Result.x, rk4Result.y,
                        p.depth, currentSimDay, 5
                    );

                    if (pathCheck.safe) {
                        p.x = rk4Result.x; p.y = rk4Result.y;
                        p.depth = rk4Result.depth;
                        p.velocityU = rk4Result.u_avg || 0;
                        p.velocityV = rk4Result.v_avg || 0;
                    } else {
                        p.x = pathCheck.lastValidX; p.y = pathCheck.lastValidY;
                        p.velocityU = 0; p.velocityV = 0;
                    }
                } else if (velocity.found) {
                    const newX = p.x + velocity.u * 86.4 * deltaDays;
                    const newY = p.y + velocity.v * 86.4 * deltaDays;

                    const pathCheck = await this._checkPathToOcean(prevX, prevY, newX, newY, p.depth, currentSimDay, 5);

                    if (pathCheck.safe) {
                        p.x = newX; p.y = newY;
                        p.velocityU = velocity.u; p.velocityV = velocity.v;
                    } else {
                        p.x = pathCheck.lastValidX; p.y = pathCheck.lastValidY;
                    }
                }

                // Diffusion
                if (this.ekeLoader && this.params.diffusivityScale > 0.01) {
                    const beforeX = p.x, beforeY = p.y;
                    await this.applyDiffusion(p, deltaDays, currentSimDay);

                    const diffCheck = await this._checkPathToOcean(beforeX, beforeY, p.x, p.y, p.depth, currentSimDay);
                    if (!diffCheck.safe) {
                        p.x = beforeX; p.y = beforeY;
                    }
                }

                // Land check
                if (await this.checkLandInteraction(p, prevX, prevY, prevDepth, currentSimDay)) {
                    this.stats.particlesOnLand++;
                    continue;
                }

                // Vertical motion
                if (this.params.verticalMixing) {
                    this.applyVerticalMotion(p, dtSeconds);
                }

                // Aging
                p.age += deltaDays;

                // Update concentration
                p.concentration = this.calculateConcentration(p);
                if (p.concentration > this.stats.maxConcentration) {
                    this.stats.maxConcentration = p.concentration;
                }


                // Update history
                if (Math.abs(p.x - prevX) > 1 || Math.abs(p.y - prevY) > 1) {
                    p.history.push({ x: p.x, y: p.y, depth: p.depth });
                    if (p.history.length > 8) p.history.shift();
                }
            }
        }

        this.stats.activeParticles = this.getActiveParticles().length;
    }


    // ==================== VELOCITY METHODS ====================

    async getVelocitiesForGroup(particles, targetDepth, simulationDay) {
        if (!this.hycomLoader) {
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }

        const positions = particles.map(p => ({
            lon: this.REFERENCE_LON + (p.x / this.LON_SCALE),
            lat: this.REFERENCE_LAT + (p.y / this.LAT_SCALE)
        }));

        try {
            return await this.hycomLoader.getVelocitiesAtMultiple(positions, targetDepth, simulationDay);
        } catch {
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }
    }

    async getVelocityAt(lon, lat, depthMeters, simDay) {
        if (!this.hycomLoader) return { u: 0, v: 0, found: false };

        try {
            const depths = this.hycomLoader.getAvailableDepths();
            let targetDepth = depths[0];
            let minDiff = Math.abs(depthMeters - depths[0]);

            for (const d of depths) {
                const diff = Math.abs(depthMeters - d);
                if (diff < minDiff) { minDiff = diff; targetDepth = d; }
            }

            return await this.hycomLoader.getVelocityAt(lon, lat, targetDepth, simDay);
        } catch {
            return { u: 0, v: 0, found: false };
        }
    }

    groupParticlesByDepth(particles) {
        if (!this.hycomLoader) return { '0': particles };

        const depths = this.hycomLoader.getAvailableDepths();
        const groups = {};

        for (const p of particles) {
            const depthM = p.depth * 1000;
            let closest = depths[0];
            let minDiff = Math.abs(depthM - depths[0]);

            for (const d of depths) {
                const diff = Math.abs(depthM - d);
                if (diff < minDiff) { minDiff = diff; closest = d; }
            }

            if (!groups[closest]) groups[closest] = [];
            groups[closest].push(p);
        }
        return groups;
    }

    // ==================== RK4 METHODS ====================

    async rk4Integrate(p, deltaDays, currentSimDay) {
        const h = this.calculateOptimalStepSize(p, deltaDays);
        const steps = Math.ceil(deltaDays / h);
        const actualStep = deltaDays / steps;

        let x = p.x, y = p.y, depth = p.depth;
        let totalU = 0, totalV = 0;

        for (let step = 0; step < steps; step++) {
            const stepTime = currentSimDay + step * actualStep;
            const result = await this.rk4Step(x, y, depth, actualStep, stepTime);

            if (!result.success) {
                return await this.eulerIntegrate(p, deltaDays, currentSimDay);
            }

            x = result.x; y = result.y; depth = result.depth;
            totalU += result.u_avg; totalV += result.v_avg;
        }

        return { x, y, depth, u_avg: totalU / steps, v_avg: totalV / steps };
    }

    async rk4Step(x, y, depth, h, currentTime) {
        try {
            const depthMeters = depth * 1000;
            const lon1 = this.REFERENCE_LON + (x / this.LON_SCALE);
            const lat1 = this.REFERENCE_LAT + (y / this.LAT_SCALE);
            const k1 = await this.getVelocityAt(lon1, lat1, depthMeters, currentTime);
            if (!k1.found) return { success: false };

            const x2 = x + h/2 * k1.u * 86.4;
            const y2 = y + h/2 * k1.v * 86.4;
            const lon2 = this.REFERENCE_LON + (x2 / this.LON_SCALE);
            const lat2 = this.REFERENCE_LAT + (y2 / this.LAT_SCALE);
            const k2 = await this.getVelocityAt(lon2, lat2, depthMeters, currentTime + h/2);

            const x3 = x + h/2 * (k2.found ? k2.u : k1.u) * 86.4;
            const y3 = y + h/2 * (k2.found ? k2.v : k1.v) * 86.4;
            const lon3 = this.REFERENCE_LON + (x3 / this.LON_SCALE);
            const lat3 = this.REFERENCE_LAT + (y3 / this.LAT_SCALE);
            const k3 = await this.getVelocityAt(lon3, lat3, depthMeters, currentTime + h/2);

            const x4 = x + h * (k3.found ? k3.u : k1.u) * 86.4;
            const y4 = y + h * (k3.found ? k3.v : k1.v) * 86.4;
            const lon4 = this.REFERENCE_LON + (x4 / this.LON_SCALE);
            const lat4 = this.REFERENCE_LAT + (y4 / this.LAT_SCALE);
            const k4 = await this.getVelocityAt(lon4, lat4, depthMeters, currentTime + h);

            const u_avg = (k1.u + 2*(k2.found?k2.u:k1.u) + 2*(k3.found?k3.u:k1.u) + (k4.found?k4.u:k1.u)) / 6;
            const v_avg = (k1.v + 2*(k2.found?k2.v:k1.v) + 2*(k3.found?k3.v:k1.v) + (k4.found?k4.v:k1.v)) / 6;

            return {
                success: true,
                x: x + h * u_avg * 86.4,
                y: y + h * v_avg * 86.4,
                depth: depth,
                u_avg, v_avg
            };
        } catch {
            return { success: false };
        }
    }

    calculateOptimalStepSize(p, totalDeltaDays) {
        if (!this.rk4Settings.adaptiveStepSize) {
            return Math.min(totalDeltaDays, this.rk4Settings.maxStepSize);
        }

        const speed = Math.sqrt(p.velocityU * p.velocityU + p.velocityV * p.velocityV);
        const charTime = 1.0 / (speed + 0.001);

        let optimalStep = Math.min(
            charTime * this.rk4Settings.timeStepSafety,
            this.rk4Settings.maxStepSize
        );

        optimalStep = Math.max(optimalStep, this.rk4Settings.minStepSize);
        return Math.min(optimalStep, totalDeltaDays);
    }

    async eulerIntegrate(p, deltaDays, currentSimDay) {
        const lon = this.REFERENCE_LON + (p.x / this.LON_SCALE);
        const lat = this.REFERENCE_LAT + (p.y / this.LAT_SCALE);
        const depthMeters = p.depth * 1000;
        const velocity = await this.getVelocityAt(lon, lat, depthMeters, currentSimDay);

        if (velocity.found) {
            return {
                x: p.x + deltaDays * velocity.u * 86.4,
                y: p.y + deltaDays * velocity.v * 86.4,
                depth: p.depth,
                u_avg: velocity.u,
                v_avg: velocity.v
            };
        }
        return { x: p.x, y: p.y, depth: p.depth, u_avg: 0, v_avg: 0 };
    }
    enableRK4(enable = true) {
        this.rk4Enabled = enable;
        this.rk4Settings.enabled = enable;
    }

    // ==================== UTILITY METHODS ====================

    getActiveParticles() {
        const active = this.particlePool.filter(p => p.active);
        const inactive = this.particlePool.filter(p => !p.active);


        return active;
    }

    gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    getDayOfYear() {
        const start = new Date(this.currentSimulationTime.getFullYear(), 0, 0);
        return Math.floor((this.currentSimulationTime - start) / 86400000);
    }

    getFormattedTime() {
        return {
            year: this.currentSimulationTime.getUTCFullYear(),
            month: this.currentSimulationTime.getUTCMonth() + 1,
            day: this.currentSimulationTime.getUTCDate()
        };
    }

    // ==================== PARAMETER CONTROL ====================

    setParameter(name, value) {
        if (name in this.params) {
            this.params[name] = value;
            return true;
        }
        return false;
    }

    setTracer(tracerId) {
        this.tracerId = tracerId;
        this.tracer = TracerLibrary[tracerId] || TracerLibrary.cs137;
        this.releaseManager.setTracer(tracerId);
        this.calculateParticleCalibration();
    }

    setReleasePhases(phases) {
        if (!this.releaseManager) return;
        this.releaseManager.phases = phases;
        this.calculateParticleCalibration();
    }
}

// Export
if (typeof window !== 'undefined') {
    window.TracerLibrary = TracerLibrary;
    window.ReleasePhase = ReleasePhase;
    window.ReleaseManager = ReleaseManager;
    window.ParticleEngine3D = ParticleEngine3D;
    window.ParticleEngine = ParticleEngine3D;
}

console.log('✅ PROTEUS Particle Engine loaded');