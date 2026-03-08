// threejsManager.js - Bridge between PROTEUS and Three.js visualization
console.log('=== Three.js Manager Loading ===');

class ThreeJSManager {
    constructor() {
        this.layer = null;
        this.isActive = false;
        this.container = document.getElementById('map-container');
        this.map = null;
        this.animationFrame = null;
        this.engine = null;
        
        // Visualization settings
        this.mode = 'concentration'; // 'concentration' or 'particles'
        this.quality = 'high'; // 'high', 'medium', 'low'
        
        // Performance monitoring
        this.stats = {
            frameTime: 0,
            particleCount: 0,
            lastFrameTime: performance.now(),
            framesSinceLastUpdate: 0
        };

        // Quality presets
        this.qualityPresets = {
            high: {
                particleCount: 50000,
                trailLength: 15,
                heatmapResolution: 512,
                particleSize: 2.5
            },
            medium: {
                particleCount: 20000,
                trailLength: 8,
                heatmapResolution: 256,
                particleSize: 2.0
            },
            low: {
                particleCount: 5000,
                trailLength: 4,
                heatmapResolution: 128,
                particleSize: 1.5
            }
        };
    }

    async init(mapInstance) {
        this.map = mapInstance;
        
        // Get quality setting from localStorage or use high
        const savedQuality = localStorage.getItem('proteus_threejs_quality');
        if (savedQuality && this.qualityPresets[savedQuality]) {
            this.quality = savedQuality;
        }
        
        // Create Three.js layer with quality settings
        const preset = this.qualityPresets[this.quality];
        
        this.layer = new ThreeJSParticleLayer({
            container: this.container,
            map: this.map,
            particleCount: preset.particleCount,
            particleSize: preset.particleSize,
            trailLength: preset.trailLength,
            heatmapResolution: preset.heatmapResolution,
            useInstancing: true,
            useShaders: true,
            sharpEdges: true, // Enable sharp dye-like appearance
            colorScheme: 'dye'
        });

        const success = await this.layer.init();
        if (success) {
            console.log('✅ Three.js visualization ready');
            this.isActive = true;
            this.startAnimation();
            
            // Set engine reference
            if (window.engine) {
                this.layer.engine = window.engine;
            }
        }
        return success;
    }

    startAnimation() {
        if (this.layer) {
            this.layer.startAnimation();
        }
    }

    stopAnimation() {
        if (this.layer) {
            this.layer.stopAnimation();
        }
    }

    // Main update method - called from app.js animation loop
    update(particles, mode = 'concentration') {
        if (!this.isActive || !this.layer || !particles) return;

        const start = performance.now();
        
        // Update mode
        this.mode = mode;
        
        // Throttle updates based on performance
        this.stats.framesSinceLastUpdate++;
        if (this.stats.framesSinceLastUpdate % 2 !== 0 && particles.length > 10000) {
            // Skip every other frame for large particle counts
            return;
        }
        
        // Convert PROTEUS particles to Three.js format
        const threeParticles = this.convertParticles(particles);
        
        // Update visualization
        this.layer.updateParticles(threeParticles, mode);
        
        // Stats
        this.stats.frameTime = performance.now() - start;
        this.stats.particleCount = particles.length;
    }

    convertParticles(particles) {
        // Use engine reference
        const engine = window.engine || this.engine;
        
        return particles.map(p => {
            if (!p || p.active === false) return null;
            
            // Handle different history formats
            let history = [];
            if (p.history) {
                if (typeof p.history.getAll === 'function') {
                    // Circular buffer
                    history = p.history.getAll();
                } else if (Array.isArray(p.history)) {
                    // Simple array
                    history = p.history;
                } else if (p.historyX && p.historyLength) {
                    // Baked format with separate arrays
                    history = [];
                    for (let i = 0; i < p.historyLength; i++) {
                        history.push({
                            x: p.historyX[i],
                            y: p.historyY[i],
                            depth: p.historyDepth?.[i] || p.depth
                        });
                    }
                }
            }

            return {
                x: p.x,
                y: p.y,
                depth: p.depth || 0,
                concentration: p.concentration || 1e-6,
                age: p.age || 0,
                active: true,
                history: history.slice(-this.layer?.config?.trailLength || 10)
            };
        }).filter(p => p !== null);
    }

    setMode(mode) {
        this.mode = mode;
        if (!this.layer) return;
        
        if (mode === 'concentration') {
            this.layer.heatmapPlane.visible = true;
            this.layer.particleSystem.visible = false;
            this.layer.trailSystem.visible = false;
        } else {
            this.layer.heatmapPlane.visible = false;
            this.layer.particleSystem.visible = true;
            this.layer.trailSystem.visible = this.layer.config.trailLength > 0;
        }
    }

    setQuality(level) {
        if (!this.qualityPresets[level]) return false;
        
        this.quality = level;
        localStorage.setItem('proteus_threejs_quality', level);
        
        const preset = this.qualityPresets[level];
        
        // Update layer config
        if (this.layer) {
            this.layer.config.particleCount = preset.particleCount;
            this.layer.config.trailLength = preset.trailLength;
            this.layer.config.heatmapResolution = preset.heatmapResolution;
            this.layer.setParticleSize(preset.particleSize);
            this.layer.setTrailLength(preset.trailLength);
        }
        
        return true;
    }

    setSharpEdges(enabled) {
        if (this.layer) {
            this.layer.setSharpEdges(enabled);
        }
    }

    setColorScheme(scheme) {
        if (this.layer && (scheme === 'dye' || scheme === 'scientific')) {
            this.layer.setColorScheme(scheme);
        }
    }

    setParticleSize(size) {
        if (this.layer) {
            this.layer.setParticleSize(size);
        }
    }

    setTrailLength(length) {
        if (this.layer) {
            this.layer.setTrailLength(length);
        }
    }

    setHeatmapIntensity(intensity) {
        if (this.layer) {
            this.layer.setHeatmapIntensity(intensity);
        }
    }

    updateCamera() {
        if (this.layer) {
            this.layer.updateCameraFromMap();
        }
    }

    resize() {
        if (this.layer) {
            this.layer.handleResize();
        }
    }

    destroy() {
        this.stopAnimation();
        if (this.layer) {
            this.layer.destroy();
            this.layer = null;
        }
        this.isActive = false;
    }

    getStats() {
        return {
            ...this.stats,
            layerStats: this.layer?.getStats() || {},
            quality: this.quality,
            mode: this.mode
        };
    }
}

// Export to global
window.ThreeJSManager = ThreeJSManager;
console.log('✅ Three.js Manager ready');