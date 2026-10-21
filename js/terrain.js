// Gelände: Höhenraster (dem.bin) -> gekachelte Meshes mit Randschürzen und Luftbildtextur.
import * as THREE from "three";

const CHUNK_CELLS = 64;
const SKIRT_DEPTH = 30;

// Gibt dem Browser Zeit zum Zeichnen, ohne von requestAnimationFrame abzuhängen (pausiert in Hintergrund-Tabs).
const channel = new MessageChannel();
const yieldToUi = () => new Promise((resolve) => { channel.port1.onmessage = resolve; channel.port2.postMessage(0); });


// Simulierter Boden: Wiese, Waldboden, Fels und befestigte Flächen werden aus der Luftbildfarbe klassiert und mit prozeduralem Detail überzogen.
const SIM_GROUND = `
float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm( vec2 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 4; i++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 17.1, 9.2 ); a *= 0.5; } return s; }
vec3 simGround( vec3 aerial, vec2 xz, float dist, float nY ) {
  float lum = dot( aerial, vec3( 0.2126, 0.7152, 0.0722 ) );
  float greenRatio = aerial.g / max( 1e-4, aerial.r + aerial.b );
  float veg = smoothstep( 0.72, 1.0, greenRatio );
  float fine = 1.0 - smoothstep( 40.0, 320.0, dist );
  float n1 = fbm( xz * 0.22 ), n3 = fbm( xz * 0.025 ), n2 = vnoise( xz * 2.6 ), n4 = vnoise( xz * 11.0 );
  vec3 g1 = vec3( 0.060, 0.155, 0.028 ), g2 = vec3( 0.135, 0.265, 0.050 ), g3 = vec3( 0.23, 0.29, 0.085 );
  vec3 grass = mix( g1, g2, smoothstep( 0.25, 0.75, n1 * 0.75 + n3 * 0.6 ) );
  grass = mix( grass, g3, smoothstep( 0.62, 0.95, n3 ) * 0.55 );
  grass *= 0.82 + 0.30 * n2 * fine + 0.14 * ( n4 - 0.5 ) * fine;
  float shade = clamp( lum / 0.12, 0.72, 1.3 );
  grass *= mix( 1.0, shade, 0.55 );
  float forest = 1.0 - smoothstep( 0.02, 0.055, lum );
  vec3 floorColor = mix( vec3( 0.13, 0.15, 0.06 ), vec3( 0.22, 0.18, 0.095 ), smoothstep( 0.3, 0.8, n1 ) ) * ( 0.8 + 0.45 * n2 * fine );
  vec3 ground = mix( grass, floorColor, forest * 0.7 );
  vec3 evened = aerial / max( lum, 1e-3 ) * clamp( lum, 0.075, 0.4 );
  vec3 other = mix( aerial, evened, 0.7 ) * ( 0.88 + 0.22 * vnoise( xz * 5.0 ) * fine + 0.1 * ( n4 - 0.5 ) * fine );
  vec3 col = mix( other, ground, veg );
  float rock = smoothstep( 0.66, 0.45, nY ) * ( 1.0 - 0.6 * veg );
  vec3 rockColor = mix( vec3( 0.10, 0.095, 0.085 ), vec3( 0.19, 0.175, 0.155 ), fbm( xz * 0.45 ) ) * ( 0.8 + 0.4 * n4 * fine );
  return mix( col, rockColor, rock * 0.85 );
}
`;

export class Terrain {
  constructor(dem, frame) {
    this.dem = dem;
    this.frame = frame;
    this.group = new THREE.Group();
    this.group.name = "terrain";
    this.material = new THREE.MeshStandardMaterial({ color: 0xc9d1c2, roughness: 0.95, metalness: 0 });
    this.#installShader();
    this.chunks = [];
    this.width = (dem.nx - 1) * dem.cell;
    this.depth = (dem.ny - 1) * dem.cell;
    // lokale Koordinaten der Südwestecke
    this.minX = dem.minE - frame.originE;
    this.maxZ = -(dem.minN - frame.originN);
  }

  /** Gemeinsamer Shader: historische Karte (links der Trennlinie) und hochauflösendes Luftbild in Blicknähe. */
  #installShader() {
    const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    blank.needsUpdate = true;
    this.uniforms = {
      uHistory: { value: blank }, uSplit: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
      uHires: { value: blank }, uHiresRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uHiresMix: { value: 0 }, uGroundMode: { value: 0 },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 vTerrXZ; varying vec3 vTerrN;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvTerrXZ = position.xz; vTerrN = normal;");
      shader.fragmentShader = "uniform sampler2D uHistory; uniform float uSplit; uniform vec2 uResolution; uniform sampler2D uHires; uniform vec4 uHiresRect; uniform float uHiresMix; uniform float uGroundMode; varying vec2 vTerrXZ; varying vec3 vTerrN;\n" + SIM_GROUND
        + shader.fragmentShader.replace("#include <map_fragment>", `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        vec2 hu = (vTerrXZ - uHiresRect.xy) / uHiresRect.zw;
        if ( uHiresMix > 0.0 && hu.x > 0.0 && hu.x < 1.0 && hu.y > 0.0 && hu.y < 1.0 ) {
          float edge = min( min( hu.x, 1.0 - hu.x ), min( hu.y, 1.0 - hu.y ) );
          sampledDiffuseColor = mix( sampledDiffuseColor, texture2D( uHires, hu ), uHiresMix * smoothstep( 0.0, 0.06, edge ) );
        }
        if ( uGroundMode < 0.5 ) sampledDiffuseColor.rgb = simGround( sampledDiffuseColor.rgb, vTerrXZ, length( vViewPosition ), normalize( vTerrN ).y );
        if ( uSplit > 0.0 && gl_FragCoord.x < uSplit * uResolution.x ) sampledDiffuseColor = texture2D( uHistory, vMapUv );
        diffuseColor *= sampledDiffuseColor;
      #endif`);
    };
    this.material.customProgramCacheKey = () => "terrain-overlays-sim";
  }

  gridHeight(i, j) {
    const { values, nx, ny, scale } = this.dem;
    const ci = Math.min(nx - 1, Math.max(0, i));
    const cj = Math.min(ny - 1, Math.max(0, j));
    return values[cj * nx + ci] * scale;
  }

  /** Höhe (lokales y) an einer lokalen Position (x, z), bilinear interpoliert. */
  heightAt(x, z) {
    const { cell, nx, ny } = this.dem;
    const fi = (x - this.minX) / cell;
    const fj = (this.maxZ - z) / cell;
    if (fi < 0 || fj < 0 || fi > nx - 1 || fj > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fi));
    const j = Math.min(ny - 2, Math.floor(fj));
    const tx = fi - i, tz = fj - j;
    const h00 = this.gridHeight(i, j), h10 = this.gridHeight(i + 1, j);
    const h01 = this.gridHeight(i, j + 1), h11 = this.gridHeight(i + 1, j + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Strahl gegen das Höhenraster; liefert Punkt oder null. */
  raycast(ray, maxDistance = 40000) {
    const step = this.dem.cell * 0.8;
    const point = new THREE.Vector3();
    let previousT = 0;
    for (let t = 0; t < maxDistance; t += step) {
      ray.at(t, point);
      const ground = this.heightAt(point.x, point.z);
      if (ground !== null && point.y <= ground) {
        let lo = previousT, hi = t;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          ray.at(mid, point);
          const h = this.heightAt(point.x, point.z);
          if (h !== null && point.y <= h) hi = mid; else lo = mid;
        }
        ray.at(hi, point);
        return point.clone();
      }
      previousT = t;
    }
    return null;
  }

  /** Erzeugt alle Kacheln asynchron (je Frame wenige), damit die Oberfläche reaktionsfähig bleibt. */
  async build({ nearCenter, nearRadius, onProgress }) {
    const { nx, ny } = this.dem;
    const chunksX = Math.ceil((nx - 1) / CHUNK_CELLS);
    const chunksY = Math.ceil((ny - 1) / CHUNK_CELLS);
    const total = chunksX * chunksY;
    let done = 0;
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const i0 = cx * CHUNK_CELLS, j0 = cy * CHUNK_CELLS;
        const i1 = Math.min(nx - 1, i0 + CHUNK_CELLS), j1 = Math.min(ny - 1, j0 + CHUNK_CELLS);
        const centerX = this.minX + ((i0 + i1) / 2) * this.dem.cell;
        const centerZ = this.maxZ - ((j0 + j1) / 2) * this.dem.cell;
        const distance = Math.hypot(centerX - nearCenter.x, centerZ - nearCenter.z);
        let step = distance < nearRadius ? 1 : distance < nearRadius * 2.4 ? 2 : 4;
        if (this.#isFlat(i0, i1, j0, j1)) step = 16; // Seefläche: wenige Dreiecke genügen
        const mesh = new THREE.Mesh(this.#chunkGeometry(i0, i1, j0, j1, step), this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push(mesh);
        if (++done % 6 === 0) {
          onProgress?.(done / total);
          await yieldToUi();
        }
      }
    }
    onProgress?.(1);
  }

  #isFlat(i0, i1, j0, j1) {
    let min = Infinity, max = -Infinity;
    for (let j = j0; j <= j1; j += 4) {
      for (let i = i0; i <= i1; i += 4) {
        const h = this.gridHeight(i, j);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    return max - min < 0.3;
  }

  #chunkGeometry(i0, i1, j0, j1, step) {
    const { cell } = this.dem;
    const axis = (from, to) => {
      const list = [];
      for (let k = from; k < to; k += step) list.push(k);
      list.push(to);
      return list;
    };
    const is = axis(i0, i1), js = axis(j0, j1);
    const cols = is.length, rows = js.length;
    const gridCount = cols * rows;
    const skirtCount = 2 * (cols + rows);
    const positions = new Float32Array((gridCount + skirtCount) * 3);
    const normals = new Float32Array((gridCount + skirtCount) * 3);
    const uvs = new Float32Array((gridCount + skirtCount) * 2);
    const { nx, ny } = this.dem;
    const put = (slot, i, j) => {
      const y = this.gridHeight(i, j);
      const dhdx = (this.gridHeight(i + step, j) - this.gridHeight(i - step, j)) / (2 * step * cell);
      const dhdz = -(this.gridHeight(i, j + step) - this.gridHeight(i, j - step)) / (2 * step * cell);
      const length = Math.hypot(dhdx, 1, dhdz);
      positions.set([this.minX + i * cell, y, this.maxZ - j * cell], slot * 3);
      normals.set([-dhdx / length, 1 / length, -dhdz / length], slot * 3);
      uvs.set([i / (nx - 1), j / (ny - 1)], slot * 2);
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) put(r * cols + c, is[c], js[r]);

    const indices = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    // Schürzen an den vier Rändern verdecken Risse zwischen Kacheln mit unterschiedlicher Auflösung.
    let slot = gridCount;
    const edge = [];
    for (let c = 0; c < cols; c++) edge.push(c);
    for (let r = 1; r < rows; r++) edge.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) edge.push((rows - 1) * cols + c);
    for (let r = rows - 2; r > 0; r--) edge.push(r * cols);
    const skirtStart = slot;
    for (const source of edge) {
      positions.set([positions[source * 3], positions[source * 3 + 1] - SKIRT_DEPTH, positions[source * 3 + 2]], slot * 3);
      normals.set([normals[source * 3], normals[source * 3 + 1], normals[source * 3 + 2]], slot * 3);
      uvs.set([uvs[source * 2], uvs[source * 2 + 1]], slot * 2);
      slot++;
    }
    for (let k = 0; k < edge.length; k++) {
      const next = (k + 1) % edge.length;
      const top0 = edge[k], top1 = edge[next], low0 = skirtStart + k, low1 = skirtStart + next;
      indices.push(top0, low0, top1, top1, low0, low1, top0, top1, low0, top1, low1, low0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  setTexture(texture) {
    this.material.map = texture;
    this.material.color.set(texture ? 0xffffff : 0xc9d1c2);
    this.material.needsUpdate = true;
  }

  stats() {
    let triangles = 0;
    for (const mesh of this.chunks) triangles += mesh.geometry.index.count / 3;
    return { chunks: this.chunks.length, triangles };
  }
}
