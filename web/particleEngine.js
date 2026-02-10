// particleEngine3D_final.js
console.log('=== Loading ParticleEngine3D (Complete with 3D Physics) ===');

class ParticleEngine3D {
    constructor(numParticles = 10000) {
        console.log('🚀 Creating ParticleEngine3D 3D Physics');

        // ===== LOADERS =====
        this.hycomLoader = window.streamingHycomLoader3D;
        this.ekeLoader = window.streamingEkeLoader;


        // ===== FUKUSHIMA & GRID =====
        this.FUKUSHIMA_LON = 141.31;
        this.FUKUSHIMA_LAT = 37.42;
        this.LON_SCALE = 88.8;   // km/degree longitude at ~37°N
        this.LAT_SCALE = 111.0;  // km/degree latitude

        // ===== LAND INTERACTION SETTINGS =====
        this.landSettings = {
            enabled: true,
            coastalPushStrength: 3.0,     // km/day push toward ocean
            maxLandSearchRadius: 10.0,    // degrees for ocean search
            revertOnLand: true            // Revert to previous position if on land
        };
        this.rk4Enabled = false;  // RK4 is disabled by default
        this.rk4Settings = {
            enabled: false,              // Toggle RK4 on/off
            timeStepSafety: 0.5,         // Safety factor for adaptive timestepping
            maxStepsPerDay: 100,         // Prevent infinite loops
            adaptiveStepSize: true,      // Adjust based on velocity
            minStepSize: 0.01,           // Minimum step (days)
            maxStepSize: 0.25            // Maximum step (days)
        };
        // ===== PHYSICS PARAMETERS =====
        this.params = {
            diffusivityScale: 1.0,        // User slider: 0 = no diffusion
            simulationSpeed: 1.0,         // Real-time multiplier
            decayEnabled: true,           // Radioactive decay
            lagrangianTimescale: 7,       // T_L in days
            verticalMixing: true,         // Enable vertical diffusion
            ekmanPumping: 5e-6,           // m/s (~0.43 m/day)
            convectiveMixing: 2e-6        // m/s (~0.17 m/day) winter only
        };

        // ===== VERTICAL DIFFUSIVITY PROFILE =====
        this.kzProfile = {
            mixedLayer: { depth: 50, kz: 0.01 },      // 10⁻² m²/s
            upperOcean: { depth: 200, kz: 0.0001 },   // 10⁻⁴ m²/s
            deepOcean: { depth: 1000, kz: 0.00005 }   // 5×10⁻⁵ m²/s
        };

        // ===== ISOTOPE DATA =====
        this.isotopes = {
            'Cs137': {
                name: 'Cesium-137',
                halfLifeDays: 30.17 * 365.25, // ~30 years
                color: '#FF6B6B',
                initialMass: 1.0
            }
        };

        // ===== RELEASE PHASES (Kanda 2013, Rypina 2013) =====
        this.releasePhases = [
            {
                startDay: 10, // ~March 21, 2011
                endDay: 80,   // ~May 31, 2011
                label: 'Major Leak Events (Mar-May 2011)',
                totalActivityPBq: 13.73,
            },
            {
                startDay: 81,
                endDay: 172,
                label: 'Steady Continuous Release (Summer 2011)',
                dailyRateGBq: 93.2,
            },
            {
                startDay: 173,
                endDay: 385,
                label: 'Declining Continuous Release',
                dailyRateGBq: 33.2,
            },
            {
                startDay: 386,
                endDay: 568,
                label: 'Low-Level Continuous Release (2012)',
                dailyRateGBq: 8.1,
            }
        ];

        // Calculate Phase 1 daily rate
        const phase1 = this.releasePhases[0];
        phase1.dailyRateGBq = (phase1.totalActivityPBq * 1e6) / (phase1.endDay - phase1.startDay);

        this.concentrationScale = 1000; // Visualization scaling factor
        // Activity scaling: 1 particle = 1 GBq
        this.activityToParticleScale = 0.001;
        this.constantSigma = {
            horizontal: 10000,  // 10 km constant plume width
            vertical: 50        // 50 m constant plume height
        };

        // ===== SIMULATION STATE =====
        this.isRunning = false;
        this.lastUpdateTime = Date.now();
        this.simulationStartTime = new Date('2011-03-11T00:00:00Z');
        this.currentSimulationTime = new Date(this.simulationStartTime);

        // ===== STATISTICS =====
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0,
            particlesOnLand: 0,
            maxDepthReached: 0,
            totalConcentration: 0,
            maxConcentration: 0
        };

        // ===== PARTICLE POOL =====
        this.particlePool = [];
        this.initializeParticlePool(numParticles);

        console.log('✅ ParticleEngine3D initialized');
        console.log(`📅 Release phases: ${this.releasePhases.length} phases`);
    }

    // ==================== INITIALIZATION ====================

    async init() {
        console.log('🔄 Initializing ParticleEngine3D...');

        try {
            // Initialize HYCOM loader
            if (this.hycomLoader && !this.hycomLoader.metadata) {
                await this.hycomLoader.init();
                console.log('✅ HYCOM loader ready');
            }


            // Initialize EKE loader
            if (this.ekeLoader && !this.ekeLoader.metadata) {
                await this.ekeLoader.init();
                console.log('✅ EKE loader ready');
            }

            // Pre-load first day
            await this.hycomLoader.loadDayByOffset(0);

            console.log('✅ All loaders ready');
            return true;

        } catch (error) {
            console.error('❌ Initialization failed:', error);
            return false;
        }
    }

    initializeParticlePool(numParticles) {
        console.log(`📦 Creating pool of ${numParticles} particles`);

        for (let i = 0; i < numParticles; i++) {
            this.particlePool.push({
                id: i,
                active: false,
                isotope: 'Cs137',
                x: 0,           // km east of Fukushima
                y: 0,           // km north of Fukushima
                depth: 0,       // Depth in km (0 = surface, 1 = 1000m)
                sigma_h: 100,   // Horizontal plume size (m)
                sigma_v: 10,    // Vertical plume size (m)
                concentration: 0,   // Bq/m³
                age: 0,         // days
                mass: 1.0,      // normalized activity
                releaseDepth: 0, // Release depth (m)
                history: [],    // position trail
                velocityU: 0,   // Last known u velocity (m/s)
                velocityV: 0,   // Last known v velocity (m/s)
            });
        }
    }

    // ==================== SIMULATION CONTROL ====================

    startSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('🚀 Starting simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();

        // Release initial particles if none active
        if (this.stats.totalReleased === 0) {
            this.currentSimulationTime = new Date(this.simulationStartTime);
            this.stats.simulationDays = 0;

            // Release initial particles for first 10 days (March 11-21, 2011)
            const initialActivityPBq = 2.0;
            const initialParticles = Math.floor(initialActivityPBq * 1e6 * this.activityToParticleScale);

            if (initialParticles > 0) {
                const released = this.releaseParticles(initialParticles);
                console.log(`📈 Released ${released} particles for early March (11-21, 2011)`);
            }
        }
    }

    pauseSimulation() {
        if (!this.isRunning) {
            console.warn('Simulation already paused');
            return;
        }

        console.log('⏸️ Pausing simulation');
        this.isRunning = false;
    }

    resumeSimulation() {
        if (this.isRunning) {
            console.warn('Simulation already running');
            return;
        }

        console.log('▶️ Resuming simulation');
        this.isRunning = true;
        this.lastUpdateTime = Date.now();
    }

    stopSimulation() {
        console.log('⏹️ Stopping simulation');
        this.isRunning = false;
    }

    resetSimulation() {
        console.log('🔄 Resetting simulation');

        this.isRunning = false;
        this.currentSimulationTime = new Date(this.simulationStartTime);
        this.stats = {
            totalReleased: 0,
            totalDecayed: 0,
            simulationDays: 0,
            activeParticles: 0,
            particlesOnLand: 0,
            maxDepthReached: 0,
            totalConcentration: 0,
            maxConcentration: 0
        };

        // Reset all particles
        for (const p of this.particlePool) {
            p.active = false;
            p.x = 0;
            p.y = 0;
            p.depth = 0;
            p.age = 0;
            p.mass = 1.0;
            p.concentration = 0;
            p.history = [];
            p.velocityU = 0;
            p.velocityV = 0;
            p.oceanDepth = 0;
        }
    }

    // ==================== PARTICLE RELEASE ====================

    releaseParticles(count) {
        let released = 0;
        const RELEASE_CENTER = { lon: 145.31, lat: 37.42 };
        const SIGMA = 30.0 / this.LON_SCALE; // 30km spread

        for (const p of this.particlePool) {
            if (!p.active && released < count) {
                // Generate position near Fukushima
                let lon, lat;
                do {
                    // Box-Muller for normal distribution
                    const u1 = Math.random();
                    const u2 = Math.random();
                    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

                    lon = RELEASE_CENTER.lon + z0 * SIGMA;
                    lat = RELEASE_CENTER.lat + z1 * SIGMA;

                    // Constrain to reasonable bounds
                    lon = Math.max(RELEASE_CENTER.lon - SIGMA * 3,
                                 Math.min(RELEASE_CENTER.lon + SIGMA * 3, lon));
                    lat = Math.max(RELEASE_CENTER.lat - SIGMA * 3,
                                 Math.min(RELEASE_CENTER.lat + SIGMA * 3, lat));

                } while (!this.isPositionInOcean(lon, lat)); // Simple check

                p.x = (lon - this.FUKUSHIMA_LON) * this.LON_SCALE;
                p.y = (lat - this.FUKUSHIMA_LAT) * this.LAT_SCALE;
                p.depth = 0; // Surface release
                p.sigma_h = this.constantSigma.horizontal;
                p.sigma_v = this.constantSigma.vertical;
                p.active = true;
                p.age = 0;
                p.mass = 1.0;
                p.concentration = this.calculateConcentration(p);
                p.history = [{x: p.x, y: p.y, depth: p.depth}];

                released++;
            }
        }

        this.stats.totalReleased += released;
        if (released > 0) {
            console.log(`🎯 Released ${released} particles`);
        }

        return released;
    }


    // ==================== CONTINUOUS RELEASE ====================

    executeContinuousRelease(deltaDays) {
        if (!this.isRunning) return;

        const currentSimDay = this.stats.simulationDays;
        let totalParticlesToRelease = 0;

        // Check each release phase
        for (const phase of this.releasePhases) {
            if (currentSimDay >= phase.startDay && currentSimDay <= phase.endDay) {
                const particlesThisStep = phase.dailyRateGBq * this.activityToParticleScale * deltaDays;
                totalParticlesToRelease += particlesThisStep;
            }
        }

        // Release particles
        if (totalParticlesToRelease > 0) {
            const count = Math.floor(totalParticlesToRelease);
            this.releaseParticles(count);
        }
    }


    async checkAndHandleLandCollision(p, prevX, prevY, prevDepth, currentSimDay) {
        if (!this.landSettings.enabled) return true;

        const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
        const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

        try {
            const isOcean = await this.hycomLoader.isOcean(lon, lat, 0, currentSimDay);

            if (!isOcean) {
                console.log(`🚫 Particle ${p.id} on land at (${lon.toFixed(2)}°, ${lat.toFixed(2)}°)`);

                // Revert immediately
                p.x = prevX;
                p.y = prevY;
                p.depth = prevDepth;
                return false;
            }

            return true;
        } catch (error) {
            console.warn('Land check failed:', error);
            p.x = prevX;
            p.y = prevY;
            p.depth = prevDepth;
            return false;
        }
    }

    isPositionInOcean(lon, lat, depthMeters = 0) {
        // Simplified: Always return true since we're checking with HYCOM elsewhere
        // This is kept for compatibility with existing code
        return true;
    }

    // ==================== 3D PHYSICS ====================

    getVerticalDiffusivity(depthMeters) {
        if (depthMeters < this.kzProfile.mixedLayer.depth) {
            return this.kzProfile.mixedLayer.kz;
        } else if (depthMeters < this.kzProfile.upperOcean.depth) {
            return this.kzProfile.upperOcean.kz;
        } else {
            return this.kzProfile.deepOcean.kz;
        }
    }

    calculateConcentration(p) {
        const M = p.mass * 1e9; // GBq → Bq

        // Use constant sigma values
        const volume = Math.pow(2 * Math.PI, 1.5) *
                       this.constantSigma.horizontal *
                       this.constantSigma.horizontal *
                       this.constantSigma.vertical;

        let concentration = M / Math.max(volume, 1e9); // Minimum 1 km³ volume

        // Apply visualization scaling
        concentration *= this.concentrationScale;

        // Clamp to realistic range
        concentration = Math.max(concentration, 1e-6);
        concentration = Math.min(concentration, 1e6);

        return concentration;
    }

    gaussianRandom() {
        // Box-Muller transform for normal distribution
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    // ==================== MAIN UPDATE LOOP ====================

    async update() {
        if (!this.isRunning) return;

        const now = Date.now();
        const realElapsedSeconds = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        // Simulation time elapsed (days)
        const deltaDays = realElapsedSeconds * this.params.simulationSpeed;

        // Update simulation clock
        this.currentSimulationTime.setTime(
            this.currentSimulationTime.getTime() + deltaDays * 86400000
        );
        this.stats.simulationDays += deltaDays;

        // 1. Continuous release
        this.executeContinuousRelease(deltaDays);

        // 2. Update particles
        await this.updateParticles(deltaDays);
    }

    // ==================== MAIN UPDATE LOOP ====================

    async updateParticles(deltaDays) {
        if (!this.isRunning) return;

        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        const currentSimDay = this.stats.simulationDays;
        const prevSimDay = currentSimDay - deltaDays;
        const dtSeconds = deltaDays * 86400;

        // Group particles by depth for optimized velocity lookups
        const depthGroups = this.groupParticlesByDepth(activeParticles);

        for (const [depthStr, particles] of Object.entries(depthGroups)) {
            const targetDepth = parseFloat(depthStr);

            // Get velocities for this depth group
            const velocities = await this.getVelocitiesForGroup(particles, targetDepth, currentSimDay);

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                const velocity = velocities[i];

                // Store previous position for land check and history
                const prevX = p.x;
                const prevY = p.y;
                const prevDepth = p.depth;

                // ===== 1. RK4 INTEGRATION (OR EULER FALLBACK) =====
                if (this.rk4Enabled && this.rk4Settings.enabled) {
                    // Use RK4 for more accurate advection
                    const rk4Result = await this.rk4Integrate(p, deltaDays, currentSimDay);
                    p.x = rk4Result.x;
                    p.y = rk4Result.y;
                    p.depth = rk4Result.depth;
                    p.velocityU = rk4Result.u_avg || 0;
                    p.velocityV = rk4Result.v_avg || 0;
                    p.lastIntegration = 'rk4';
                } else {
                    // Fall back to Euler integration
                    if (velocity.found) {
                        p.velocityU = velocity.u;
                        p.velocityV = velocity.v;
                        p.x += velocity.u * 86.4 * deltaDays;
                        p.y += velocity.v * 86.4 * deltaDays;
                    }
                    p.lastIntegration = 'euler';
                }

                // ===== 2. EKE DIFFUSION =====
                if (this.ekeLoader && this.params.diffusivityScale > 0) {
                    try {
                        const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
                        const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);
                        const ekeResult = await this.ekeLoader.getDiffusivityAt(lon, lat, currentSimDay);

                        if (ekeResult.found) {
                            const K_m2_s = ekeResult.K * this.params.diffusivityScale;
                            const K_km2_day = K_m2_s * 86.4;
                            const stepSize = Math.sqrt(2 * K_km2_day * deltaDays);

                            // Random walk diffusion (adds to RK4/Euler result)
                            p.x += (Math.random() - 0.5) * stepSize * 2.0;
                            p.y += (Math.random() - 0.5) * stepSize * 2.0;
                        }
                    } catch (error) {
                        // Fallback diffusion if EKE lookup fails
                        const fallbackK = 20; // m²/s
                        const stepSize = Math.sqrt(2 * fallbackK * 86.4 * deltaDays);
                        p.x += (Math.random() - 0.5) * stepSize;
                        p.y += (Math.random() - 0.5) * stepSize;
                    }
                }

                // ===== 3. IMMEDIATE LAND CHECK =====
                const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
                const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);

                try {
                    const isOcean = await this.hycomLoader.isOcean(lon, lat, 0, currentSimDay);

                    if (!isOcean) {
                        console.log(`🚫 Particle ${p.id} moved onto land at (${lon.toFixed(2)}°, ${lat.toFixed(2)}°)`);

                        // REVERT TO PREVIOUS POSITION
                        p.x = prevX;
                        p.y = prevY;
                        p.depth = prevDepth;

                        // Try to find nearest ocean and push toward it
                        const oceanCell = await this.hycomLoader.findNearestOceanCell(
                            lon, lat, 0, currentSimDay, this.landSettings.maxLandSearchRadius
                        );

                        if (oceanCell) {
                            const oceanLon = oceanCell.lon;
                            const oceanLat = oceanCell.lat;

                            // Calculate direction toward ocean
                            const dx = (oceanLon - lon) * this.LON_SCALE;
                            const dy = (oceanLat - lat) * this.LAT_SCALE;
                            const dist = Math.sqrt(dx*dx + dy*dy);

                            if (dist > 0) {
                                // Add push toward ocean FROM PREVIOUS POSITION
                                const pushStrength = this.landSettings.coastalPushStrength;
                                p.x += (dx / dist) * pushStrength * deltaDays;
                                p.y += (dy / dist) * pushStrength * deltaDays;
                            }
                        }

                        // Skip further updates for this particle in this timestep
                        continue;
                    }
                } catch (error) {
                    console.warn('Land check failed:', error);
                    // On error, revert to previous position for safety
                    p.x = prevX;
                    p.y = prevY;
                    p.depth = prevDepth;
                    continue;
                }

                // ===== 4. VERTICAL MOTION (only if particle is still in ocean) =====
                if (this.params.verticalMixing) {
                    // Get vertical diffusivity based on depth
                    const kz = this.getVerticalDiffusivity(p.depth * 1000);

                    // Random walk in vertical: dz = sqrt(2*Kz*dt) * N(0,1)
                    const verticalStdDev = Math.sqrt(2 * kz * dtSeconds);
                    const randomDz = verticalStdDev * this.gaussianRandom();

                    // Add deterministic vertical motions
                    let deterministicDz = 0;

                    // Ekman pumping (always present)
                    deterministicDz += this.params.ekmanPumping * dtSeconds;

                    // Convective mixing (winter only, surface layer)
                    const isWinter = (currentSimDay % 365) < 90; // Jan-Mar
                    if (isWinter && p.depth * 1000 < 100) {
                        deterministicDz += this.params.convectiveMixing * dtSeconds;
                    }

                    // Update depth (convert meters to km)
                    const totalDz = (randomDz + deterministicDz) / 1000;
                    p.depth += totalDz;

                    // Apply boundaries
                    p.depth = Math.max(0, Math.min(p.depth, 1.0));

                    // Update max depth statistic
                    const currentDepthMeters = p.depth * 1000;
                    if (currentDepthMeters > this.stats.maxDepthReached) {
                        this.stats.maxDepthReached = currentDepthMeters;
                    }
                }

                // Keep sigma constant (simplified plume model)
                p.sigma_h = this.constantSigma.horizontal;
                p.sigma_v = this.constantSigma.vertical;

                // ===== 5. RADIOACTIVE DECAY =====
                p.age += deltaDays;
                if (this.params.decayEnabled) {
                    const halfLife = this.isotopes.Cs137.halfLifeDays;
                    p.mass *= Math.pow(0.5, deltaDays / halfLife);

                    // Deactivate particle if mass is too low
                    if (p.mass < 0.001) {
                        p.active = false;
                        this.stats.totalDecayed++;
                        continue; // Skip to next particle
                    }
                }

                // ===== 6. UPDATE CONCENTRATION =====
                p.concentration = this.calculateConcentration(p);

                // Update concentration statistics
                this.stats.totalConcentration += p.concentration;
                if (p.concentration > this.stats.maxConcentration) {
                    this.stats.maxConcentration = p.concentration;
                }

                // ===== 7. UPDATE POSITION TRAIL =====
                if (Math.abs(p.x - prevX) > 1 || Math.abs(p.y - prevY) > 1) {
                    p.history.push({ x: p.x, y: p.y, depth: p.depth });

                    // Keep history trail manageable
                    if (p.history.length > 8) {
                        p.history.shift();
                    }
                }

                // ===== 8. UPDATE PARTICLE STATISTICS =====
                if (p.concentration > 0 && !isNaN(lon) && !isNaN(lat)) {
                    // Track particles that end up on land
                    const isCurrentlyOnLand = !await this.hycomLoader.isOcean(lon, lat, 0, currentSimDay);
                    if (isCurrentlyOnLand) {
                        this.stats.particlesOnLand++;
                    }
                }
            }
        }

        // ===== 9. UPDATE SIMULATION STATISTICS =====
        this.stats.activeParticles = this.getActiveParticles().length;

        // Log statistics every integer simulation day
        if (Math.floor(this.stats.simulationDays) !== Math.floor(prevSimDay)) {
            this.logStatistics();

            // Optional: Log RK4 performance if enabled
            if (this.rk4Enabled) {
                this.logRK4Statistics();
            }
        }
    }

    // ==================== RK4 STATISTICS ====================

    logRK4Statistics() {
        const activeParticles = this.getActiveParticles();
        const rk4Particles = activeParticles.filter(p => p.lastIntegration === 'rk4').length;
        const eulerParticles = activeParticles.filter(p => p.lastIntegration === 'euler').length;

        console.log(`🧮 RK4 Statistics:`);
        console.log(`   RK4 particles: ${rk4Particles}`);
        console.log(`   Euler particles: ${eulerParticles}`);

        // Calculate average velocity magnitude
        let totalSpeed = 0;
        let count = 0;
        for (const p of activeParticles) {
            const speed = Math.sqrt(p.velocityU * p.velocityU + p.velocityV * p.velocityV);
            if (!isNaN(speed)) {
                totalSpeed += speed;
                count++;
            }
        }

        if (count > 0) {
            const avgSpeed = totalSpeed / count;
            console.log(`   Average speed: ${(avgSpeed * 100).toFixed(1)} cm/s`);
        }
    }

    // ==================== OPTIMIZATION METHODS ====================


    async getVelocitiesForGroup(particles, targetDepth, simulationDay) {
        const positions = particles.map(p => ({
            lon: this.FUKUSHIMA_LON + (p.x / this.LON_SCALE),
            lat: this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE)
        }));

        try {
            return await this.hycomLoader.getVelocitiesAtMultiple(
                positions,
                targetDepth,
                simulationDay
            );
        } catch (error) {
            console.warn(`Velocity lookup failed for depth ${targetDepth}m:`, error);
            return particles.map(() => ({ u: 0, v: 0, found: false }));
        }
    }

    // ==================== RK4 INTEGRATION METHODS ====================
    enableRK4(enable = true) {
        this.rk4Enabled = enable;
        this.rk4Settings.enabled = enable;
        console.log(`🔧 RK4 ${enable ? 'enabled' : 'disabled'}`);

        // Initialize particle integration tracking
        if (enable) {
            for (const p of this.particlePool) {
                p.lastIntegration = 'none';
                p.integrationSteps = 0;
            }
        }
    }
    async rk4Integrate(p, deltaDays, currentSimDay) {
        if (!this.rk4Enabled || !this.rk4Settings) {
            return await this.eulerIntegrate(p, deltaDays, currentSimDay);
        }

        const h = this.calculateOptimalStepSize(p, deltaDays);
        const steps = Math.ceil(deltaDays / h);
        const actualStep = deltaDays / steps;

        let x = p.x;
        let y = p.y;
        let depth = p.depth;
        let totalU = 0;
        let totalV = 0;

        for (let step = 0; step < steps; step++) {
            const stepTime = currentSimDay + step * actualStep;
            const result = await this.rk4Step(x, y, depth, actualStep, stepTime);

            if (!result.success) {
                console.warn(`RK4 step ${step + 1}/${steps} failed for particle ${p.id}, falling back to Euler`);
                return await this.eulerIntegrate(p, deltaDays, currentSimDay);
            }

            x = result.x;
            y = result.y;
            depth = result.depth;
            totalU += result.u_avg;
            totalV += result.v_avg;
        }

        return {
            x, y, depth,
            u_avg: totalU / steps,
            v_avg: totalV / steps,
            stepsTaken: steps,
            stepUsed: actualStep
        };
    }

    calculateOptimalStepSize(p, totalDeltaDays) {
        if (!this.rk4Settings.adaptiveStepSize) {
            return Math.min(totalDeltaDays, this.rk4Settings.maxStepSize);
        }

        // Estimate based on current velocity
        const speed = Math.sqrt(p.velocityU * p.velocityU + p.velocityV * p.velocityV);
        const characteristicTime = 1.0 / (speed + 0.001); // Avoid division by zero

        // CFL-like condition: Δt ∝ Δx / v
        let optimalStep = Math.min(
            characteristicTime * this.rk4Settings.timeStepSafety,
            this.rk4Settings.maxStepSize
        );

        optimalStep = Math.max(optimalStep, this.rk4Settings.minStepSize);
        optimalStep = Math.min(optimalStep, totalDeltaDays);

        return optimalStep;
    }
    async rk4Step(x, y, depth, h, currentTime) {
        try {
            const depthMeters = depth * 1000;

            // k1 = f(t, y)
            const lon1 = this.FUKUSHIMA_LON + (x / this.LON_SCALE);
            const lat1 = this.FUKUSHIMA_LAT + (y / this.LAT_SCALE);
            const k1 = await this.getVelocityAt(lon1, lat1, depthMeters, currentTime);

            if (!k1.found) {
                return { success: false };
            }

            // k2 = f(t + h/2, y + h*k1/2)
            const x2 = x + h/2 * k1.u * 86.4;
            const y2 = y + h/2 * k1.v * 86.4;
            const lon2 = this.FUKUSHIMA_LON + (x2 / this.LON_SCALE);
            const lat2 = this.FUKUSHIMA_LAT + (y2 / this.LAT_SCALE);
            const k2 = await this.getVelocityAt(lon2, lat2, depthMeters, currentTime + h/2);

            // k3 = f(t + h/2, y + h*k2/2)
            const x3 = x + h/2 * (k2.found ? k2.u : k1.u) * 86.4;
            const y3 = y + h/2 * (k2.found ? k2.v : k1.v) * 86.4;
            const lon3 = this.FUKUSHIMA_LON + (x3 / this.LON_SCALE);
            const lat3 = this.FUKUSHIMA_LAT + (y3 / this.LAT_SCALE);
            const k3 = await this.getVelocityAt(lon3, lat3, depthMeters, currentTime + h/2);

            // k4 = f(t + h, y + h*k3)
            const x4 = x + h * (k3.found ? k3.u : k1.u) * 86.4;
            const y4 = y + h * (k3.found ? k3.v : k1.v) * 86.4;
            const lon4 = this.FUKUSHIMA_LON + (x4 / this.LON_SCALE);
            const lat4 = this.FUKUSHIMA_LAT + (y4 / this.LAT_SCALE);
            const k4 = await this.getVelocityAt(lon4, lat4, depthMeters, currentTime + h);

            // Weighted average
            const u_avg = (1/6) * (
                k1.u +
                2 * (k2.found ? k2.u : k1.u) +
                2 * (k3.found ? k3.u : k1.u) +
                (k4.found ? k4.u : k1.u)
            );

            const v_avg = (1/6) * (
                k1.v +
                2 * (k2.found ? k2.v : k1.v) +
                2 * (k3.found ? k3.v : k1.v) +
                (k4.found ? k4.v : k1.v)
            );

            // RK4 update
            const newX = x + h * u_avg * 86.4;
            const newY = y + h * v_avg * 86.4;
            const newDepth = depth;

            return {
                success: true,
                x: newX,
                y: newY,
                depth: newDepth,
                u_avg, v_avg
            };

        } catch (error) {
            console.error('RK4 step failed:', error);
            return { success: false };
        }
    }
    async eulerIntegrate(p, deltaDays, currentSimDay) {
        const lon = this.FUKUSHIMA_LON + (p.x / this.LON_SCALE);
        const lat = this.FUKUSHIMA_LAT + (p.y / this.LAT_SCALE);
        const depthMeters = p.depth * 1000;

        const velocity = await this.getVelocityAt(lon, lat, depthMeters, currentSimDay);

        if (velocity.found) {
            return {
                x: p.x + deltaDays * velocity.u * 86.4,
                y: p.y + deltaDays * velocity.v * 86.4,
                depth: p.depth,
                u_avg: velocity.u,
                v_avg: velocity.v,
                stepsTaken: 1,
                stepUsed: deltaDays
            };
        }

        return {
            x: p.x,
            y: p.y,
            depth: p.depth,
            u_avg: 0,
            v_avg: 0,
            stepsTaken: 1,
            stepUsed: deltaDays
        };
    }

    async getVelocityAt(lon, lat, depthMeters, simDay) {
        if (!this.hycomLoader) {
            return { u: 0, v: 0, found: false };
        }

        try {
            const availableDepths = this.hycomLoader.getAvailableDepths();
            let targetDepth = availableDepths[0];
            let minDiff = Math.abs(depthMeters - availableDepths[0]);

            for (const availDepth of availableDepths) {
                const diff = Math.abs(depthMeters - availDepth);
                if (diff < minDiff) {
                    minDiff = diff;
                    targetDepth = availDepth;
                }
            }

            return await this.hycomLoader.getVelocityAt(lon, lat, targetDepth, simDay);
        } catch (error) {
            console.warn('Velocity lookup failed:', error);
            return { u: 0, v: 0, found: false };
        }
    }
    // ==================== VELOCITY LOOKUP OPTIMIZATION ====================

    groupParticlesByDepth(particles) {
        const groups = {};
        const availableDepths = this.hycomLoader.getAvailableDepths();

        for (const p of particles) {
            const depthMeters = p.depth * 1000;

            // Find closest available depth
            let closestDepth = availableDepths[0];
            let minDiff = Math.abs(depthMeters - availableDepths[0]);

            for (const availDepth of availableDepths) {
                const diff = Math.abs(depthMeters - availDepth);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestDepth = availDepth;
                }
            }

            if (!groups[closestDepth]) {
                groups[closestDepth] = [];
            }
            groups[closestDepth].push(p);
        }

        return groups;
    }


    // ==================== STATISTICS & LOGGING ====================

    logStatistics() {
        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return;

        const currentSimDay = this.stats.simulationDays;

        // Calculate distances
        const distances = activeParticles.map(p => Math.sqrt(p.x * p.x + p.y * p.y));
        const meanDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
        const maxDistance = Math.max(...distances);

        // Depth distribution
        const depthBuckets = { surface: 0, upper: 0, intermediate: 0, deep: 0 };
        for (const p of activeParticles) {
            const depthMeters = p.depth * 1000;
            if (depthMeters < 50) depthBuckets.surface++;
            else if (depthMeters < 200) depthBuckets.upper++;
            else if (depthMeters < 500) depthBuckets.intermediate++;
            else depthBuckets.deep++;
        }

        console.log(`📊 PLUME STATISTICS - Day ${currentSimDay.toFixed(1)}:`);
        console.log(`   Active particles: ${activeParticles.length}`);
        console.log(`   Mean distance: ${meanDistance.toFixed(1)} km`);
        console.log(`   Max distance: ${maxDistance.toFixed(1)} km`);
        console.log(`   Depth distribution:`);
        console.log(`     Surface (0-50m): ${depthBuckets.surface}`);
        console.log(`     Upper (50-200m): ${depthBuckets.upper}`);
        console.log(`     Intermediate (200-500m): ${depthBuckets.intermediate}`);
        console.log(`     Deep (500-1000m): ${depthBuckets.deep}`);
        console.log(`   Max depth reached: ${this.stats.maxDepthReached.toFixed(0)} m`);
        console.log(`   Particles on land: ${this.stats.particlesOnLand}`);
        console.log(`   Max concentration: ${this.stats.maxConcentration.toExponential(2)} Bq/m³`);
    }

    getStats() {
        const activeParticles = this.getActiveParticles();
        const distances = activeParticles.map(p => Math.sqrt(p.x * p.x + p.y * p.y));
        const meanDistance = distances.length > 0 ?
            distances.reduce((a, b) => a + b, 0) / distances.length : 0;

        return {
            isRunning: this.isRunning,
            daysElapsed: this.stats.simulationDays.toFixed(2),
            totalParticles: this.stats.totalReleased,
            activeParticles: activeParticles.length,
            decayedParticles: this.stats.totalDecayed,
            meanDistance: meanDistance.toFixed(1),
            maxDepth: this.stats.maxDepthReached.toFixed(0),
            particlesOnLand: this.stats.particlesOnLand,
            maxConcentration: this.stats.maxConcentration.toExponential(2),
        };
    }

    getDepthDistribution() {
        const activeParticles = this.getActiveParticles();
        const buckets = { surface: 0, upper: 0, intermediate: 0, deep: 0 };

        for (const p of activeParticles) {
            const depthMeters = p.depth * 1000;
            if (depthMeters < 50) buckets.surface++;
            else if (depthMeters < 200) buckets.upper++;
            else if (depthMeters < 500) buckets.intermediate++;
            else buckets.deep++;
        }

        return buckets;
    }

    // ==================== UTILITY METHODS ====================

    getActiveParticles() {
        return this.particlePool.filter(p => p.active);
    }

    getFormattedTime() {
        return {
            year: this.currentSimulationTime.getUTCFullYear(),
            month: this.currentSimulationTime.getUTCMonth() + 1,
            day: this.currentSimulationTime.getUTCDate(),
            hour: this.currentSimulationTime.getUTCHours(),
            minute: this.currentSimulationTime.getUTCMinutes(),
            second: this.currentSimulationTime.getUTCSeconds()
        };
    }

    setParameter(name, value) {
        if (name in this.params) {
            console.log(`🔧 Parameter ${name}: ${this.params[name]} → ${value}`);
            this.params[name] = value;
            return true;
        }
        console.warn(`⚠️ Unknown parameter: ${name}`);
        return false;
    }


    // ==================== EXPORT METHODS ====================

    getParticleData() {
        return this.getActiveParticles().map(p => ({
            x: p.x,
            y: p.y,
            depth: p.depth,
            concentration: p.concentration,
            age: p.age,
            mass: p.mass,
            oceanDepth: p.oceanDepth
        }));
    }

    getConcentrationField(gridSize = 100) {
        // Create a 2D concentration grid
        const grid = Array(gridSize).fill().map(() => Array(gridSize).fill(0));

        // Define grid bounds (based on active particles)
        const activeParticles = this.getActiveParticles();
        if (activeParticles.length === 0) return grid;

        const xs = activeParticles.map(p => p.x);
        const ys = activeParticles.map(p => p.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        // Add a buffer
        const buffer = 50; // km
        const gridMinX = minX - buffer;
        const gridMaxX = maxX + buffer;
        const gridMinY = minY - buffer;
        const gridMaxY = maxY + buffer;

        // Accumulate concentration in grid cells
        for (const p of activeParticles) {
            const gridX = Math.floor((p.x - gridMinX) / (gridMaxX - gridMinX) * (gridSize - 1));
            const gridY = Math.floor((p.y - gridMinY) / (gridMaxY - gridMinY) * (gridSize - 1));

            if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
                grid[gridY][gridX] += p.concentration;
            }
        }

        return {
            grid,
            bounds: { minX: gridMinX, maxX: gridMaxX, minY: gridMinY, maxY: gridMaxY }
        };
    }
}

// Export to global scope
if (typeof window !== 'undefined') {
    window.ParticleEngine3D = ParticleEngine3D;
    window.ParticleEngine = ParticleEngine3D; // Keep original name for compatibility
    console.log('✅ ParticleEngine3D loaded');
}

console.log('=== ParticleEngine3D script complete ===');