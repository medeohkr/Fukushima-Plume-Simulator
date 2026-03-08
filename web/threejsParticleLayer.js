// threejsParticleLayer.js - High-performance Three.js visualization for PROTEUS
// Features: Sharp dye-like appearance, trails, heatmap, depth-based rendering
console.log('=== Three.js Particle Layer Loading ===');

class ThreeJSParticleLayer {
    constructor(options = {}) {
        this.container = options.container || document.getElementById('map-container');
        this.map = options.map;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.particleSystem = null;
        this.trailSystem = null;
        this.heatmapSystem = null;
        this.heatmapPlane = null;
        this.heatmapTarget = null;
        
        // Configuration with defaults
        this.config = {
            particleCount: options.particleCount || 50000,
            particleSize: options.particleSize || 2.5,
            trailLength: options.trailLength || 10,
            trailOpacity: options.trailOpacity || 0.4,
            heatmapResolution: options.heatmapResolution || 512,
            heatmapBlur: options.heatmapBlur || 0, // 0 = sharp, >0 = blurred
            useInstancing: true,
            useShaders: true,
            sharpEdges: true, // New: enable sharp dye-like appearance
            colorScheme: 'dye' // 'dye' or 'scientific'
        };

        // State
        this.particles = [];
        this.trails = [];
        this.heatmapData = null;
        this.animationFrame = null;
        this.isInitialized = false;
        this.lastCameraUpdate = 0;
        
        // Shader materials
        this.particleMaterial = null;
        this.trailMaterial = null;
        this.heatmapMaterial = null;
        
        // Performance
        this.stats = {
            fps: 0,
            particleCount: 0,
            trailCount: 0,
            lastFrameTime: 0,
            frameCount: 0,
            lastFPSUpdate: 0
        };

        // Engine reference (will be set externally)
        this.engine = null;
        
        console.log('🎨 Three.js Layer created with config:', this.config);
    }

    async init() {
        try {
            await this.initThreeJS();
            await this.initParticleSystem();
            await this.initTrailSystem();
            await this.initHeatmapSystem();
            
            this.isInitialized = true;
            console.log('✅ Three.js layer ready');
            return true;
        } catch (error) {
            console.error('❌ Three.js init failed:', error);
            return false;
        }
    }

    initThreeJS() {
        return new Promise((resolve) => {
            // Create scene
            this.scene = new THREE.Scene();
            this.scene.background = null; // Transparent

            // Create camera (will be updated with map view)
            this.camera = new THREE.PerspectiveCamera(45, 
                (window.innerWidth - 360) / window.innerHeight, 0.1, 10000);
            
            // Create renderer with transparent background
            this.renderer = new THREE.WebGLRenderer({ 
                antialias: true, 
                alpha: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: false,
                stencil: false,
                depth: true
            });
            
            this.renderer.setSize(window.innerWidth - 360, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit for performance
            this.renderer.setClearColor(0x000000, 0); // Transparent
            
            // Add to container with proper z-index
            this.renderer.domElement.style.position = 'absolute';
            this.renderer.domElement.style.top = '0';
            this.renderer.domElement.style.left = '0';
            this.renderer.domElement.style.pointerEvents = 'none';
            this.renderer.domElement.style.zIndex = '600';
            this.container.appendChild(this.renderer.domElement);

            // Handle resize
            window.addEventListener('resize', () => this.handleResize());

            resolve();
        });
    }

    // ==================== CUSTOM SHADERS ====================

    createColorTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        
        if (this.config.colorScheme === 'dye') {
            // SHARP DYE-LIKE COLOR SCHEME (discrete bands)
            const gradient = ctx.createLinearGradient(0, 0, 512, 0);
            
            // Very low - transparent cyan
            gradient.addColorStop(0.0, 'rgba(200, 255, 255, 0.3)');
            gradient.addColorStop(0.1, 'rgba(100, 200, 255, 0.6)');
            
            // Low - electric blue
            gradient.addColorStop(0.2, 'rgba(50, 100, 255, 0.9)');
            gradient.addColorStop(0.3, 'rgba(80, 80, 255, 1.0)');
            
            // Medium - purple/magenta
            gradient.addColorStop(0.4, 'rgba(150, 50, 255, 1.0)');
            gradient.addColorStop(0.5, 'rgba(200, 50, 200, 1.0)');
            
            // High - hot pink/red
            gradient.addColorStop(0.6, 'rgba(255, 50, 100, 1.0)');
            gradient.addColorStop(0.7, 'rgba(255, 30, 30, 1.0)');
            
            // Very high - bright orange
            gradient.addColorStop(0.8, 'rgba(255, 100, 0, 1.0)');
            gradient.addColorStop(0.9, 'rgba(255, 150, 0, 1.0)');
            
            // Peak - bright yellow
            gradient.addColorStop(1.0, 'rgba(255, 220, 0, 1.0)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 512, 1);
        } else {
            // Scientific color scheme (smooth gradient)
            const gradient = ctx.createLinearGradient(0, 0, 512, 0);
            gradient.addColorStop(0.0, '#e7ecfb');
            gradient.addColorStop(0.2, '#a2baf4');
            gradient.addColorStop(0.4, '#4473e3');
            gradient.addColorStop(0.6, '#fcb8c5');
            gradient.addColorStop(0.8, '#ff2900');
            gradient.addColorStop(1.0, '#ffd801');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 512, 1);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    createParticleShader() {
        const colorTexture = this.createColorTexture();
        
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                colorScale: { value: colorTexture },
                minConcentration: { value: 1e-6 },
                maxConcentration: { value: 1e6 },
                pointSize: { value: this.config.particleSize },
                sharpEdges: { value: this.config.sharpEdges ? 1.0 : 0.0 }
            },
            vertexShader: `
                attribute float concentration;
                attribute float age;
                attribute vec3 color;
                
                uniform float time;
                uniform float pointSize;
                uniform sampler2D colorScale;
                uniform float minConcentration;
                uniform float maxConcentration;
                uniform float sharpEdges;
                
                varying vec4 vColor;
                varying float vSharpness;
                
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Calculate size based on distance
                    float dist = length(mvPosition.xyz);
                    float size = pointSize * (500.0 / max(dist, 1.0));
                    
                    // Log concentration for color mapping
                    float logConc = log(concentration + 1e-30) / log(10.0);
                    float logMin = log(minConcentration) / log(10.0);
                    float logMax = log(maxConcentration) / log(10.0);
                    float normConc = (logConc - logMin) / (logMax - logMin);
                    normConc = clamp(normConc, 0.0, 1.0);
                    
                    // Size modulation based on concentration
                    size *= (0.8 + 0.4 * normConc);
                    
                    gl_PointSize = clamp(size, 2.0, 12.0);
                    
                    // Sample color from texture
                    vec4 sampledColor = texture2D(colorScale, vec2(normConc, 0.5));
                    vColor = sampledColor;
                    vSharpness = sharpEdges;
                }
            `,
            fragmentShader: `
                varying vec4 vColor;
                varying float vSharpness;
                
                void main() {
                    vec2 center = vec2(0.5, 0.5);
                    float dist = distance(gl_PointCoord, center);
                    
                    float alpha;
                    if (vSharpness > 0.5) {
                        // SHARP DYE MODE: Square particles
                        if (abs(gl_PointCoord.x - 0.5) > 0.45 || 
                            abs(gl_PointCoord.y - 0.5) > 0.45) {
                            discard;
                        }
                        alpha = 0.95; // Nearly opaque
                    } else {
                        // SOFT MODE: Glowing circles
                        alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                        // Add glow
                        float glow = 0.3 * (1.0 - dist) * (1.0 - smoothstep(0.4, 0.5, dist));
                        alpha += glow;
                        alpha = clamp(alpha, 0.0, 0.9);
                    }
                    
                    gl_FragColor = vec4(vColor.rgb, alpha);
                    
                    // Use additive blending for overlap
                    if (gl_FragColor.a < 0.05) discard;
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    createTrailShader() {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                opacity: { value: this.config.trailOpacity }
            },
            vertexShader: `
                attribute float age;
                attribute float segmentId;
                attribute float totalSegments;
                
                uniform float time;
                uniform float opacity;
                
                varying float vAge;
                varying float vAlpha;
                
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    
                    // Fade trails based on position in trail
                    float t = segmentId / max(totalSegments, 1.0);
                    vAge = age;
                    vAlpha = opacity * (1.0 - t) * 0.8;
                }
            `,
            fragmentShader: `
                uniform float time;
                varying float vAge;
                varying float vAlpha;
                
                void main() {
                    // Color based on age (young = red, old = blue)
                    float ageNorm = clamp(vAge / 500.0, 0.0, 1.0);
                    
                    vec3 color;
                    if (vAge < 100.0) {
                        color = vec3(1.0, 0.3, 0.3); // Red for young
                    } else if (vAge < 300.0) {
                        color = mix(vec3(1.0, 0.3, 0.3), vec3(1.0, 0.8, 0.2), 
                                   (vAge - 100.0) / 200.0); // Orange transition
                    } else {
                        color = vec3(0.2, 0.6, 1.0); // Blue for old
                    }
                    
                    gl_FragColor = vec4(color, vAlpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    createHeatmapShader() {
        return new THREE.ShaderMaterial({
            uniforms: {
                particleTexture: { value: null },
                intensity: { value: 1.0 },
                time: { value: 0 },
                colorScale: { value: this.createColorTexture() },
                sharpEdges: { value: this.config.sharpEdges ? 1.0 : 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D particleTexture;
                uniform sampler2D colorScale;
                uniform float intensity;
                uniform float time;
                uniform float sharpEdges;
                varying vec2 vUv;
                
                void main() {
                    // Sample particle density
                    float density = texture2D(particleTexture, vUv).r;
                    
                    if (density < 0.01) discard;
                    
                    // Apply intensity
                    float val = density * intensity;
                    
                    // Get color from scale
                    vec4 color = texture2D(colorScale, vec2(val, 0.5));
                    
                    if (sharpEdges > 0.5) {
                        // SHARP MODE: Enhance edges
                        float dx = 1.0 / 512.0;
                        float left = texture2D(particleTexture, vUv - vec2(dx, 0.0)).r;
                        float right = texture2D(particleTexture, vUv + vec2(dx, 0.0)).r;
                        float up = texture2D(particleTexture, vUv + vec2(0.0, dx)).r;
                        float down = texture2D(particleTexture, vUv - vec2(0.0, dx)).r;
                        
                        float edge = abs(right - left) + abs(up - down);
                        
                        // Darken edges slightly for definition
                        color.rgb *= (1.0 - edge * 0.5);
                        
                        // Solid opacity
                        gl_FragColor = vec4(color.rgb, 0.9);
                    } else {
                        // Soft mode
                        gl_FragColor = vec4(color.rgb, val * 0.8);
                    }
                }
            `,
            transparent: true,
            blending: THREE.NormalBlending
        });
    }

    // ==================== PARTICLE SYSTEM ====================

    initParticleSystem() {
        const maxParticles = this.config.particleCount;
        
        // Create geometry
        const geometry = new THREE.BufferGeometry();
        
        // Position array (x, y, z)
        const positions = new Float32Array(maxParticles * 3);
        // Color array (r, g, b) - optional, we'll use shader-based coloring
        const colors = new Float32Array(maxParticles * 3);
        // Concentration array
        const concentrations = new Float32Array(maxParticles);
        // Age array
        const ages = new Float32Array(maxParticles);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('concentration', new THREE.BufferAttribute(concentrations, 1));
        geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
        
        // Create material
        this.particleMaterial = this.createParticleShader();
        
        // Create points system
        this.particleSystem = new THREE.Points(geometry, this.particleMaterial);
        this.particleSystem.frustumCulled = false;
        this.particleSystem.visible = true;
        this.scene.add(this.particleSystem);
        
        console.log('✨ Particle system initialized with', maxParticles, 'slots');
    }

    initTrailSystem() {
        // Use LineSegments for trails
        const maxTrails = 20000;
        const maxSegments = this.config.trailLength;
        const totalVertices = maxTrails * maxSegments * 2; // 2 vertices per segment
        
        const geometry = new THREE.BufferGeometry();
        
        const positions = new Float32Array(totalVertices * 3);
        const ages = new Float32Array(totalVertices);
        const segmentIds = new Float32Array(totalVertices);
        const totalSegments = new Float32Array(totalVertices);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
        geometry.setAttribute('segmentId', new THREE.BufferAttribute(segmentIds, 1));
        geometry.setAttribute('totalSegments', new THREE.BufferAttribute(totalSegments, 1));
        
        this.trailMaterial = this.createTrailShader();
        
        this.trailSystem = new THREE.LineSegments(geometry, this.trailMaterial);
        this.trailSystem.frustumCulled = false;
        this.trailSystem.visible = false; // Start hidden
        this.scene.add(this.trailSystem);
        
        console.log('🛤️ Trail system initialized');
    }

    initHeatmapSystem() {
        // Create off-screen render target for heatmap
        this.heatmapTarget = new THREE.WebGLRenderTarget(
            this.config.heatmapResolution,
            this.config.heatmapResolution,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.FloatType
            }
        );
        
        // Create heatmap plane
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.heatmapMaterial = this.createHeatmapShader();
        
        this.heatmapPlane = new THREE.Mesh(geometry, this.heatmapMaterial);
        this.heatmapPlane.visible = false;
        this.scene.add(this.heatmapPlane);
        
        console.log('🔥 Heatmap system initialized');
    }

    // ==================== DATA UPDATE ====================

    updateParticles(particles, mode = 'particles') {
        if (!this.isInitialized || !particles || particles.length === 0) return;
        
        this.stats.particleCount = Math.min(particles.length, this.config.particleCount);
        
        if (mode === 'particles') {
            this.updateParticlePositions(particles);
            this.updateTrails(particles);
            this.particleSystem.visible = true;
            this.trailSystem.visible = this.config.trailLength > 0;
            this.heatmapPlane.visible = false;
        } else if (mode === 'concentration') {
            this.updateHeatmap(particles);
            this.particleSystem.visible = false;
            this.trailSystem.visible = false;
            this.heatmapPlane.visible = true;
        }
        
        // Update camera if needed
        this.updateCameraFromMap();
    }

    updateParticlePositions(particles) {
        const geometry = this.particleSystem.geometry;
        const positions = geometry.attributes.position.array;
        const concentrations = geometry.attributes.concentration.array;
        const ages = geometry.attributes.age.array;
        
        const count = Math.min(particles.length, this.config.particleCount);
        
        // Use global engine reference if available
        const engine = window.engine || this.engine;
        if (!engine) {
            console.warn('No engine reference for coordinate conversion');
            return;
        }
        
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            if (!p || p.active === false) continue;
            
            // Convert to lat/lon using engine constants
            const lon = engine.REFERENCE_LON + (p.x / engine.LON_SCALE);
            const lat = engine.REFERENCE_LAT + (p.y / engine.LAT_SCALE);
            
            // Convert to WebGL coordinates (simple plate carrée projection)
            // Scale to make world visible at zoom level 3
            const x = (lon - 180) * 50;
            const y = lat * 50;
            const z = (p.depth || 0) * -200; // Negative Z for depth (down)
            
            positions[i*3] = x;
            positions[i*3+1] = y;
            positions[i*3+2] = z;
            
            concentrations[i] = p.concentration || 1e-6;
            ages[i] = p.age || 0;
        }
        
        // Hide unused particles by moving them far away
        for (let i = count; i < this.config.particleCount; i++) {
            positions[i*3+2] = -10000; // Far below
        }
        
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.concentration.needsUpdate = true;
        geometry.attributes.age.needsUpdate = true;
        
        geometry.setDrawRange(0, count);
    }

    updateTrails(particles) {
        if (!this.config.trailLength || this.config.trailLength < 2) return;
        
        const geometry = this.trailSystem.geometry;
        const positions = geometry.attributes.position.array;
        const ages = geometry.attributes.age.array;
        const segmentIds = geometry.attributes.segmentId.array;
        const totalSegments = geometry.attributes.totalSegments.array;
        
        const engine = window.engine || this.engine;
        if (!engine) return;
        
        let vertexIndex = 0;
        const maxTrails = Math.min(particles.length, 10000); // Limit trails for performance
        
        for (let i = 0; i < maxTrails; i++) {
            const p = particles[i];
            if (!p || p.active === false || !p.history || p.history.length < 2) continue;
            
            // Handle different history formats
            let history = p.history;
            if (typeof history.getAll === 'function') {
                history = history.getAll();
            }
            
            if (!history || history.length < 2) continue;
            
            const trailLen = Math.min(history.length, this.config.trailLength);
            
            for (let j = 0; j < trailLen - 1; j++) {
                if (vertexIndex + 1 >= positions.length / 3) break;
                
                const h1 = history[history.length - 1 - j];
                const h2 = history[history.length - 2 - j];
                
                // Convert to lat/lon
                const lon1 = engine.REFERENCE_LON + (h1.x / engine.LON_SCALE);
                const lat1 = engine.REFERENCE_LAT + (h1.y / engine.LAT_SCALE);
                const lon2 = engine.REFERENCE_LON + (h2.x / engine.LON_SCALE);
                const lat2 = engine.REFERENCE_LAT + (h2.y / engine.LAT_SCALE);
                
                // Convert to WebGL coordinates
                const x1 = (lon1 - 180) * 50;
                const y1 = lat1 * 50;
                const z1 = (h1.depth || 0) * -200;
                
                const x2 = (lon2 - 180) * 50;
                const y2 = lat2 * 50;
                const z2 = (h2.depth || 0) * -200;
                
                // First vertex
                positions[vertexIndex*3] = x1;
                positions[vertexIndex*3+1] = y1;
                positions[vertexIndex*3+2] = z1;
                ages[vertexIndex] = p.age || 0;
                segmentIds[vertexIndex] = j;
                totalSegments[vertexIndex] = trailLen;
                vertexIndex++;
                
                // Second vertex
                positions[vertexIndex*3] = x2;
                positions[vertexIndex*3+1] = y2;
                positions[vertexIndex*3+2] = z2;
                ages[vertexIndex] = p.age || 0;
                segmentIds[vertexIndex] = j + 0.5;
                totalSegments[vertexIndex] = trailLen;
                vertexIndex++;
            }
        }
        
        // Hide unused vertices
        for (let i = vertexIndex; i < positions.length / 3; i++) {
            positions[i*3+2] = -10000;
        }
        
        geometry.setDrawRange(0, vertexIndex);
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.age.needsUpdate = true;
        geometry.attributes.segmentId.needsUpdate = true;
        geometry.attributes.totalSegments.needsUpdate = true;
        
        this.stats.trailCount = Math.floor(vertexIndex / 2);
    }

    updateHeatmap(particles) {
        const engine = window.engine || this.engine;
        if (!engine) return;
        
        // Create particle texture for heatmap
        const canvas = document.createElement('canvas');
        canvas.width = this.config.heatmapResolution;
        canvas.height = this.config.heatmapResolution;
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw particles as density points
        const count = Math.min(particles.length, 50000);
        const scaleX = canvas.width / 360;
        const scaleY = canvas.height / 180;
        
        // First pass: collect min/max for normalization
        let maxConc = 1e-30;
        const validParticles = [];
        
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            if (!p || p.active === false) continue;
            
            const lon = engine.REFERENCE_LON + (p.x / engine.LON_SCALE);
            const lat = engine.REFERENCE_LAT + (p.y / engine.LAT_SCALE);
            
            // Skip invalid coordinates
            if (isNaN(lon) || isNaN(lat) || Math.abs(lat) > 90) continue;
            
            const x = (lon + 180) * scaleX;
            const y = canvas.height - (lat + 90) * scaleY;
            
            if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) continue;
            
            const conc = p.concentration || 1e-6;
            if (conc > maxConc) maxConc = conc;
            
            validParticles.push({ x, y, conc });
        }
        
        if (validParticles.length === 0) return;
        
        // Draw particles with intensity based on concentration
        ctx.fillStyle = 'white';
        
        if (this.config.sharpEdges) {
            // SHARP MODE: Use grid accumulation for crisp edges
            const gridSize = 4;
            const gridWidth = Math.floor(canvas.width / gridSize);
            const gridHeight = Math.floor(canvas.height / gridSize);
            const grid = new Float32Array(gridWidth * gridHeight);
            
            // Accumulate in grid
            validParticles.forEach(p => {
                const gx = Math.floor(p.x / gridSize);
                const gy = Math.floor(p.y / gridSize);
                if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
                    grid[gy * gridWidth + gx] += p.conc / maxConc;
                }
            });
            
            // Draw grid cells
            for (let gy = 0; gy < gridHeight; gy++) {
                for (let gx = 0; gx < gridWidth; gx++) {
                    const val = grid[gy * gridWidth + gx];
                    if (val === 0) continue;
                    
                    const intensity = Math.min(val * 2, 1.0); // Boost visibility
                    ctx.fillStyle = `rgba(255, 255, 255, ${intensity})`;
                    ctx.fillRect(gx * gridSize, gy * gridSize, gridSize, gridSize);
                }
            }
        } else {
            // SOFT MODE: Draw individual particles with blur
            validParticles.forEach(p => {
                const intensity = Math.log10(p.conc + 1) / Math.log10(maxConc + 1);
                ctx.fillStyle = `rgba(255, 255, 255, ${intensity * 0.5})`;
                ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
            });
        }
        
        // Apply slight blur for smoother appearance (if not in sharp mode)
        if (!this.config.sharpEdges && this.config.heatmapBlur > 0) {
            const blurred = document.createElement('canvas');
            blurred.width = canvas.width;
            blurred.height = canvas.height;
            const bCtx = blurred.getContext('2d');
            bCtx.filter = `blur(${this.config.heatmapBlur}px)`;
            bCtx.drawImage(canvas, 0, 0);
            
            // Update texture
            if (this.heatmapMaterial.uniforms.particleTexture.value) {
                this.heatmapMaterial.uniforms.particleTexture.value.dispose();
            }
            
            const texture = new THREE.CanvasTexture(blurred);
            texture.minFilter = this.config.sharpEdges ? THREE.NearestFilter : THREE.LinearFilter;
            texture.magFilter = this.config.sharpEdges ? THREE.NearestFilter : THREE.LinearFilter;
            
            this.heatmapMaterial.uniforms.particleTexture.value = texture;
        } else {
            // Update texture directly
            if (this.heatmapMaterial.uniforms.particleTexture.value) {
                this.heatmapMaterial.uniforms.particleTexture.value.dispose();
            }
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = this.config.sharpEdges ? THREE.NearestFilter : THREE.LinearFilter;
            texture.magFilter = this.config.sharpEdges ? THREE.NearestFilter : THREE.LinearFilter;
            
            this.heatmapMaterial.uniforms.particleTexture.value = texture;
        }
    }

    // ==================== CAMERA CONTROL ====================

    updateCameraFromMap() {
        if (!this.map || !this.camera) return;
        
        // Throttle updates (max 30fps)
        const now = Date.now();
        if (now - this.lastCameraUpdate < 33) return;
        this.lastCameraUpdate = now;
        
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        
        if (!center) return;
        
        // Convert map view to 3D camera
        // Scale factor based on zoom level
        const scale = Math.pow(1.5, zoom - 3) * 60;
        
        // Position camera above the map center
        this.camera.position.x = (center.lng - 180) * 50;
        this.camera.position.y = center.lat * 50;
        this.camera.position.z = 1000 / scale;
        
        // Look at map center
        this.camera.lookAt(
            (center.lng - 180) * 50,
            center.lat * 50,
            0
        );
        
        // Update projection matrix
        this.camera.updateProjectionMatrix();
    }

    // ==================== RENDERING ====================

    startAnimation() {
        if (this.animationFrame) return;
        
        const animate = (time) => {
            this.animationFrame = requestAnimationFrame(animate);
            
            // Update shader uniforms
            if (this.particleMaterial) {
                this.particleMaterial.uniforms.time.value = time / 1000;
            }
            if (this.trailMaterial) {
                this.trailMaterial.uniforms.time.value = time / 1000;
            }
            if (this.heatmapMaterial) {
                this.heatmapMaterial.uniforms.time.value = time / 1000;
            }
            
            // Render
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
            
            // FPS calculation
            this.stats.frameCount++;
            if (time - this.stats.lastFPSUpdate > 1000) {
                this.stats.fps = this.stats.frameCount;
                this.stats.frameCount = 0;
                this.stats.lastFPSUpdate = time;
            }
        };
        
        this.animationFrame = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    // ==================== UTILITY ====================

    handleResize() {
        if (!this.renderer || !this.camera) return;
        
        const width = window.innerWidth - 360;
        const height = window.innerHeight;
        
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    setParticleSize(size) {
        this.config.particleSize = size;
        if (this.particleMaterial) {
            this.particleMaterial.uniforms.pointSize.value = size;
        }
    }

    setTrailLength(length) {
        this.config.trailLength = length;
        this.trailSystem.visible = length > 0;
    }

    setHeatmapIntensity(intensity) {
        if (this.heatmapMaterial) {
            this.heatmapMaterial.uniforms.intensity.value = intensity;
        }
    }

    setSharpEdges(enabled) {
        this.config.sharpEdges = enabled;
        if (this.particleMaterial) {
            this.particleMaterial.uniforms.sharpEdges.value = enabled ? 1.0 : 0.0;
        }
        if (this.heatmapMaterial) {
            this.heatmapMaterial.uniforms.sharpEdges.value = enabled ? 1.0 : 0.0;
        }
    }

    setColorScheme(scheme) {
        this.config.colorScheme = scheme;
        // Recreate color textures
        if (this.particleMaterial) {
            this.particleMaterial.uniforms.colorScale.value = this.createColorTexture();
        }
        if (this.heatmapMaterial) {
            this.heatmapMaterial.uniforms.colorScale.value = this.createColorTexture();
        }
    }

    clear() {
        // Remove all particles
        if (this.particleSystem) {
            this.scene.remove(this.particleSystem);
            this.particleSystem.geometry.dispose();
            this.particleSystem.material.dispose();
        }
        
        if (this.trailSystem) {
            this.scene.remove(this.trailSystem);
            this.trailSystem.geometry.dispose();
            this.trailSystem.material.dispose();
        }
        
        if (this.heatmapPlane) {
            this.scene.remove(this.heatmapPlane);
            this.heatmapPlane.material.dispose();
        }
        
        this.stopAnimation();
    }

    destroy() {
        this.clear();
        
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
        
        if (this.heatmapTarget) {
            this.heatmapTarget.dispose();
        }
    }

    getStats() {
        return this.stats;
    }
}

// Export to global
window.ThreeJSParticleLayer = ThreeJSParticleLayer;
console.log('✅ Three.js Particle Layer ready');